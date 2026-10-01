import { db } from "@/db/client";
import type { RequestContext } from "@/lib/auth/request-context";
import { assertCompanyAccess, requirePermission } from "@/lib/auth/request-context";
import { can, canManageUserRole } from "@/lib/auth/rbac";
import { invalidateSessionsForUserInCompany } from "@/lib/auth/session";
import { AuthorizationError, isUniqueViolation } from "@/lib/errors";
import { recordAuditLog } from "@/domains/audit/service";
import { branchRepository, departmentRepository, designationRepository } from "@/domains/organization/repository";
import { BranchNotFoundError, DepartmentNotFoundError, DesignationNotFoundError } from "@/domains/organization/errors";
import { companyMembershipRepository } from "@/domains/auth/repository";
import { userManagementRepository } from "@/domains/auth/user-management.repository";
import { assertEmployeeInScope, getEmployeeScope } from "./scope";
import * as storage from "@/lib/storage";
import {
  employeeDocumentRepository,
  employeeHistoryRepository,
  employeeNumberCounterRepository,
  employeeOnboardingRepository,
  employeeOnboardingTaskRepository,
  employeeRepository,
} from "./repository";
import {
  CircularManagerHierarchyError,
  DuplicateEmployeeNumberError,
  DuplicateWorkEmailError,
  EmployeeDocumentNotFoundError,
  EmployeeHasActiveDirectReportsError,
  EmployeeNotFoundError,
  InvalidManagerError,
  InvalidUserLinkError,
  OnboardingNotFoundError,
  SelfManagerError,
} from "./errors";
import {
  DEFAULT_EXPIRY_WARNING_DAYS,
  DEFAULT_ONBOARDING_TASKS,
  type CreateEmployeeDocumentInput,
  type CreateEmployeeInput,
  type DocumentExpiryStatus,
  type Employee,
  type EmployeeDocument,
  type EmployeeDocumentSummary,
  type EmployeeHistoryEntry,
  type EmployeeHistoryEventType,
  type EmployeeListFilters,
  type EmployeeListResult,
  type EmployeeOnboardingWithTasks,
  type EmployeeWithRelations,
  type EmploymentStatus,
  type OrgChartNode,
  type UpdateEmployeeInput,
} from "./model";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

function clampPagination(filters: EmployeeListFilters): EmployeeListFilters {
  return {
    ...filters,
    page: Math.max(1, filters.page || 1),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize || DEFAULT_PAGE_SIZE)),
  };
}

/**
 * Fields visible to anyone with `employee.view` (directory, cross-employee lookups). Everything
 * else (contact/personal/emergency-contact details) requires `employee.view_private`, or being
 * the employee themself (self-view always sees the full record — enforced by callers, not here).
 */
const PUBLIC_FIELDS = new Set<keyof Employee>([
  "id",
  "companyId",
  "employeeNumber",
  "firstName",
  "middleName",
  "lastName",
  "preferredName",
  "photoStorageKey",
  "workEmail",
  "departmentId",
  "designationId",
  "locationId",
  "managerId",
  "employmentType",
  "employmentStatus",
  "dateOfJoining",
  "onboardingStatus",
  "isArchived",
  "archivedAt",
  "userId",
  "createdAt",
  "updatedAt",
]);

// Relation objects (joined display data, not raw columns) are never redacted — they're not
// part of the "private" scalar fields this gate protects, and the directory/profile need them
// regardless of `view_private`.
const RELATION_FIELDS = new Set(["department", "designation", "location", "manager"]);

function redactPrivateFields<T extends Employee>(employee: T): T {
  const redacted = { ...employee } as Record<string, unknown>;
  for (const key of Object.keys(redacted)) {
    if (!PUBLIC_FIELDS.has(key as keyof Employee) && !RELATION_FIELDS.has(key)) {
      redacted[key] = null;
    }
  }
  return redacted as T;
}

function isSelf(ctx: RequestContext, employee: Employee): boolean {
  return employee.userId !== null && employee.userId === ctx.userId;
}

async function assertReferencedEntitiesBelongToCompany(
  ctx: RequestContext,
  input: { departmentId?: string | null; designationId?: string | null; locationId?: string | null },
): Promise<void> {
  if (input.departmentId) {
    const department = await departmentRepository.findById(input.departmentId);
    if (!department) throw new DepartmentNotFoundError();
    assertCompanyAccess(ctx, department.companyId);
  }
  if (input.designationId) {
    const designation = await designationRepository.findById(input.designationId);
    if (!designation) throw new DesignationNotFoundError();
    assertCompanyAccess(ctx, designation.companyId);
  }
  if (input.locationId) {
    const branch = await branchRepository.findById(input.locationId);
    if (!branch) throw new BranchNotFoundError();
    assertCompanyAccess(ctx, branch.companyId);
  }
}

/** F-02/F-04 - a MANAGER may act only on their own reporting line (see `scope.ts`); other roles unchanged. */
async function assertInManagerScope(ctx: RequestContext, employeeId: string): Promise<void> {
  await assertEmployeeInScope(ctx, employeeId);
}

/**
 * F-04 - what a line manager may EDIT. `employee.update` was granted to MANAGER for placement changes on
 * their team ("department/location"), but the service accepted every field: a manager could rewrite a
 * report's work email, joining date, reporting manager or personal data. A MANAGER may now change only
 * department, designation and location, never their own record, and only fields that actually change are
 * judged (the edit form always submits the whole record).
 */
const MANAGER_EDITABLE_FIELDS: ReadonlySet<string> = new Set(["departmentId", "designationId", "locationId"]);

function assertManagerMayChange(ctx: RequestContext, existing: Employee, input: UpdateEmployeeInput): void {
  if (ctx.role !== "MANAGER") return;
  if (existing.id === ctx.employeeId) {
    throw new AuthorizationError("A manager cannot edit their own employee record.");
  }
  const current = existing as unknown as Record<string, unknown>;
  const forbidden = Object.entries(input as Record<string, unknown>)
    .filter(([key, next]) => {
      if (MANAGER_EDITABLE_FIELDS.has(key) || next === undefined) return false;
      const normalize = (value: unknown) => (typeof value === "string" && key === "workEmail" ? value.toLowerCase().trim() : (value ?? null));
      return normalize(next) !== normalize(current[key]);
    })
    .map(([key]) => key);
  if (forbidden.length > 0) {
    throw new AuthorizationError(`A manager may only change department, designation and location. Not permitted: ${forbidden.join(", ")}.`);
  }
}

async function assertValidManager(ctx: RequestContext, managerId: string): Promise<void> {
  const manager = await employeeRepository.findById(managerId);
  if (!manager) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, manager.companyId);
  if (manager.isArchived) throw new InvalidManagerError("The selected manager is archived and cannot be assigned.");
}

/**
 * Walks the proposed manager's existing reporting chain; throws if `employeeId` appears in it
 * (employeeId would already be an ancestor of newManagerId, so the assignment would close a
 * cycle), or if newManagerId is employeeId itself (self-manager).
 */
async function assertNoCircularManagerHierarchy(employeeId: string, newManagerId: string): Promise<void> {
  if (newManagerId === employeeId) throw new SelfManagerError();

  const visited = new Set<string>();
  let current = await employeeRepository.findById(newManagerId);
  while (current?.managerId) {
    if (current.managerId === employeeId) throw new CircularManagerHierarchyError();
    if (visited.has(current.id)) break; // guards against pre-existing bad data forming a loop
    visited.add(current.id);
    current = await employeeRepository.findById(current.managerId);
  }
}

export async function listEmployees(ctx: RequestContext, filters: EmployeeListFilters): Promise<EmployeeListResult> {
  requirePermission(ctx, "employee.view");
  const scope = await getEmployeeScope(ctx);
  const clamped = { ...clampPagination(filters), ...(scope ? { scopeEmployeeIds: [...scope] } : {}) };
  const [items, total] = await Promise.all([
    employeeRepository.listByCompany(ctx.companyId, clamped),
    employeeRepository.countByCompany(ctx.companyId, clamped),
  ]);
  const canViewPrivate = can(ctx.role, "employee.view_private");
  return {
    items: canViewPrivate ? items : items.map(redactPrivateFields),
    total,
    page: clamped.page,
    pageSize: clamped.pageSize,
  };
}

/** Lightweight "Employee" filter dropdown source (Batch 6 attendance reports) — not the full
 *  paginated `listEmployees` result, just enough to populate a `<select>`. */
export async function listActiveEmployeesForDropdown(
  ctx: RequestContext,
): Promise<{ id: string; employeeNumber: string; firstName: string; lastName: string }[]> {
  requirePermission(ctx, "employee.view");
  const scope = await getEmployeeScope(ctx);
  const all = await employeeRepository.listActiveForDropdown(ctx.companyId);
  return scope ? all.filter((e) => scope.has(e.id)) : all;
}

export async function getEmployee(ctx: RequestContext, employeeId: string): Promise<EmployeeWithRelations> {
  // F-24: decide permission BEFORE looking the employee up, so a caller without it gets the same denial whether or
  // not the id exists. (`ctx.employeeId` is the caller's own employee, resolved from their session.)
  if (ctx.employeeId !== employeeId) requirePermission(ctx, "employee.view");
  const employee = await employeeRepository.findByIdWithRelations(employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, employee.companyId);

  const self = isSelf(ctx, employee);
  if (!self) {
    requirePermission(ctx, "employee.view");
    await assertInManagerScope(ctx, employee.id);
  }
  if (self || can(ctx.role, "employee.view_private")) {
    return employee;
  }
  return redactPrivateFields(employee);
}

export async function getMyEmployeeRecord(ctx: RequestContext): Promise<Employee> {
  const employee = await employeeRepository.findByUserId(ctx.companyId, ctx.userId);
  if (!employee) throw new EmployeeNotFoundError();
  return employee;
}

export async function createEmployee(ctx: RequestContext, input: CreateEmployeeInput): Promise<Employee> {
  requirePermission(ctx, "employee.create");

  await assertReferencedEntitiesBelongToCompany(ctx, input);
  if (input.managerId) {
    await assertValidManager(ctx, input.managerId);
  }
  if (input.userId) {
    const membership = await companyMembershipRepository.findForUserAndCompany(input.userId, ctx.companyId);
    if (!membership) throw new InvalidUserLinkError();
  }

  const workEmail = input.workEmail.toLowerCase().trim();

  const employee = await db.transaction(async (tx) => {
    const employeeNumber = await employeeNumberCounterRepository.issueNextNumber(tx, ctx.companyId);

    let created: Employee;
    try {
      created = await employeeRepository.create(tx, ctx.companyId, {
        ...input,
        workEmail,
        employeeNumber,
        createdByUserId: ctx.userId,
        updatedByUserId: ctx.userId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await employeeRepository.findByWorkEmail(ctx.companyId, workEmail);
        if (existing) throw new DuplicateWorkEmailError(workEmail);
        // A login can be the employee record of exactly one person (employees.user_id is unique). Say so,
        // instead of mislabelling it as a duplicate employee number. (Deliberately generic: it does not say
        // which company the other record belongs to.)
        if (input.userId && (await employeeRepository.findAnyByUserId(input.userId))) {
          throw new InvalidUserLinkError("This user account is already linked to an employee record.");
        }
        throw new DuplicateEmployeeNumberError();
      }
      throw error;
    }

    await employeeHistoryRepository.create(tx, {
      companyId: ctx.companyId,
      employeeId: created.id,
      eventType: "CREATED",
      changedByUserId: ctx.userId,
      after: { employeeNumber: created.employeeNumber, firstName: created.firstName, lastName: created.lastName },
    });

    return created;
  });

  await recordAuditLog(ctx, {
    action: "employee.create",
    entityType: "employee",
    entityId: employee.id,
    newData: employee,
  });
  return employee;
}

const FIELD_EVENT_MAP: Record<string, EmployeeHistoryEventType> = {
  departmentId: "DEPARTMENT_CHANGED",
  designationId: "DESIGNATION_CHANGED",
  managerId: "MANAGER_CHANGED",
  locationId: "LOCATION_CHANGED",
  employmentType: "EMPLOYMENT_TYPE_CHANGED",
};
const TRACKED_FIELDS = Object.keys(FIELD_EVENT_MAP) as (keyof UpdateEmployeeInput)[];

export async function updateEmployee(
  ctx: RequestContext,
  employeeId: string,
  input: UpdateEmployeeInput,
): Promise<Employee> {
  requirePermission(ctx, "employee.update");
  const existing = await employeeRepository.findById(employeeId);
  if (!existing) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);
  await assertInManagerScope(ctx, existing.id);
  assertManagerMayChange(ctx, existing, input);

  await assertReferencedEntitiesBelongToCompany(ctx, input);
  if (input.managerId) {
    await assertValidManager(ctx, input.managerId);
    await assertNoCircularManagerHierarchy(employeeId, input.managerId);
  }

  const normalizedInput = input.workEmail ? { ...input, workEmail: input.workEmail.toLowerCase().trim() } : input;

  const changes: { field: (typeof TRACKED_FIELDS)[number]; before: unknown; after: unknown }[] = [];
  for (const field of TRACKED_FIELDS) {
    if (field in normalizedInput && normalizedInput[field] !== existing[field as keyof Employee]) {
      changes.push({ field, before: existing[field as keyof Employee], after: normalizedInput[field] });
    }
  }

  const employee = await db.transaction(async (tx) => {
    let updated: Employee;
    try {
      updated = await employeeRepository.update(employeeId, { ...normalizedInput, updatedByUserId: ctx.userId }, tx);
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateWorkEmailError(normalizedInput.workEmail ?? existing.workEmail);
      throw error;
    }

    for (const change of changes) {
      await employeeHistoryRepository.create(tx, {
        companyId: ctx.companyId,
        employeeId,
        eventType: FIELD_EVENT_MAP[change.field]!,
        changedByUserId: ctx.userId,
        before: { [change.field]: change.before },
        after: { [change.field]: change.after },
      });
    }

    return updated;
  });

  await recordAuditLog(ctx, {
    action: "employee.update",
    entityType: "employee",
    entityId: employee.id,
    oldData: existing,
    newData: employee,
  });
  return employee;
}

/** Statuses that mean the person has left: their login for this company is deactivated with the change. */
const ACCESS_ENDING_STATUSES: ReadonlySet<EmploymentStatus> = new Set<EmploymentStatus>(["RESIGNED", "TERMINATED"]);

const STATUS_EVENT_MAP: Partial<Record<EmploymentStatus, EmployeeHistoryEventType>> = {
  RESIGNED: "RESIGNED",
  TERMINATED: "TERMINATED",
};

export async function changeEmployeeStatus(
  ctx: RequestContext,
  employeeId: string,
  status: EmploymentStatus,
  note?: string,
): Promise<Employee> {
  requirePermission(ctx, "employee.manage_status");
  const existing = await employeeRepository.findById(employeeId);
  if (!existing) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  let revokedAccess: { userId: string; role: string } | null = null;
  const employee = await db.transaction(async (tx) => {
    revokedAccess = null;
    const updated = await employeeRepository.setEmploymentStatus(employeeId, status, ctx.userId, tx);
    await employeeHistoryRepository.create(tx, {
      companyId: ctx.companyId,
      employeeId,
      eventType: STATUS_EVENT_MAP[status] ?? "STATUS_CHANGED",
      changedByUserId: ctx.userId,
      before: { employmentStatus: existing.employmentStatus },
      after: { employmentStatus: status },
      note,
    });

    // F-12 - leaving the company ends access in the same transaction. A resigned/terminated employee's
    // linked login keeps working otherwise (a departed manager or HR user included). Only THIS company's
    // membership is deactivated and only THIS company's sessions are revoked; the user may belong to
    // others. It uses the existing user-management rule: the actor must outrank the account's role
    // (so HR cannot lock a company admin out by terminating them), and one never revokes oneself.
    // Reinstating the employee does NOT silently re-enable the login - that stays an explicit user-management action.
    if (ACCESS_ENDING_STATUSES.has(status) && updated.userId && updated.userId !== ctx.userId) {
      const membership = await companyMembershipRepository.findForUserAndCompany(updated.userId, ctx.companyId);
      if (membership && canManageUserRole(ctx.role, membership.role)) {
        await userManagementRepository.setMembershipActive(membership.id, false, tx);
        await invalidateSessionsForUserInCompany(updated.userId, ctx.companyId, tx);
        revokedAccess = { userId: updated.userId, role: membership.role };
      }
    }
    return updated;
  });

  await recordAuditLog(ctx, {
    action: "employee.status_change",
    entityType: "employee",
    entityId: employee.id,
    oldData: { employmentStatus: existing.employmentStatus },
    newData: { employmentStatus: employee.employmentStatus },
    metadata: { loginAccessRevoked: revokedAccess !== null },
  });
  const revoked = revokedAccess as { userId: string; role: string } | null;
  if (revoked) {
    await recordAuditLog(ctx, {
      action: "user.deactivated",
      entityType: "user",
      entityId: revoked.userId,
      metadata: { targetRole: revoked.role, sessionsInvalidated: true, reason: `employee_status:${status}`, employeeId: employee.id },
    });
  }
  return employee;
}

/**
 * Blocks archiving an employee who currently has active direct reports — does NOT auto-null or
 * auto-reassign them (explicit product decision). HR must reassign each direct report first via
 * the normal `updateEmployee` flow, which already validates the new manager (same company,
 * active, not the employee being archived, no circular chain). The active-direct-report count
 * is re-checked here immediately before the archive write, inside the same transaction, to
 * close the race-condition window between the check and the write.
 */
export async function archiveEmployee(ctx: RequestContext, employeeId: string): Promise<Employee> {
  requirePermission(ctx, "employee.archive");
  const existing = await employeeRepository.findById(employeeId);
  if (!existing) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  const employee = await db.transaction(async (tx) => {
    const activeDirectReports = await employeeRepository.countActiveDirectReports(employeeId, tx);
    if (activeDirectReports > 0) {
      throw new EmployeeHasActiveDirectReportsError(activeDirectReports);
    }

    const archived = await employeeRepository.setActive(employeeId, true, tx);
    await employeeHistoryRepository.create(tx, {
      companyId: ctx.companyId,
      employeeId,
      eventType: "ARCHIVED",
      changedByUserId: ctx.userId,
    });
    return archived;
  });

  await recordAuditLog(ctx, {
    action: "employee.archive",
    entityType: "employee",
    entityId: employee.id,
    oldData: existing,
    newData: employee,
  });
  return employee;
}

export async function listEmployeeHistory(ctx: RequestContext, employeeId: string): Promise<EmployeeHistoryEntry[]> {
  if (ctx.employeeId !== employeeId) requirePermission(ctx, "employee.view"); // F-24: permission first
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, employee.companyId);

  if (!isSelf(ctx, employee)) {
    requirePermission(ctx, "employee.view");
    await assertInManagerScope(ctx, employee.id);
  }
  return employeeHistoryRepository.listByEmployee(employeeId);
}

function startOfCurrentMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export async function getEmployeeCounts(ctx: RequestContext) {
  requirePermission(ctx, "employee.view");
  // F-02: every employee-based figure counts only a MANAGER's own reporting line. (Department/location
  // counts describe the company's structure, not people, and stay as they are.)
  const scope = await getEmployeeScope(ctx);
  const scopeIds = scope ? [...scope] : undefined;
  const [employeeCounts, departments, branches, newJoiners] = await Promise.all([
    employeeRepository.getCounts(ctx.companyId, scopeIds),
    departmentRepository.listByCompany(ctx.companyId),
    branchRepository.listByCompany(ctx.companyId),
    employeeRepository.countNewJoinersSince(ctx.companyId, startOfCurrentMonthIso(), scopeIds),
  ]);

  return {
    totalEmployees: employeeCounts.total,
    activeEmployees: employeeCounts.active,
    onProbation: employeeCounts.probation,
    onNoticePeriod: employeeCounts.noticePeriod,
    departmentCount: departments.filter((d) => d.isActive).length,
    locationCount: branches.filter((b) => b.isActive).length,
    newJoinersThisMonth: newJoiners,
  };
}

export async function getOnboarding(ctx: RequestContext, employeeId: string): Promise<EmployeeOnboardingWithTasks | null> {
  if (ctx.employeeId !== employeeId) requirePermission(ctx, "employee.view"); // F-24: permission first
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, employee.companyId);
  if (!isSelf(ctx, employee)) {
    requirePermission(ctx, "employee.view");
    await assertInManagerScope(ctx, employee.id);
  }
  const onboarding = await employeeOnboardingRepository.findByEmployee(employeeId);
  return onboarding ?? null;
}

/** Idempotent: calling this on an employee that already has an onboarding record just returns it. */
export async function startOnboarding(ctx: RequestContext, employeeId: string): Promise<EmployeeOnboardingWithTasks> {
  requirePermission(ctx, "employee.update");
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, employee.companyId);

  const existing = await employeeOnboardingRepository.findByEmployee(employeeId);
  if (existing) return existing;

  const onboarding = await employeeOnboardingRepository.create(employeeId, new Date());
  await employeeOnboardingTaskRepository.createMany(onboarding.id, [...DEFAULT_ONBOARDING_TASKS]);
  await employeeRepository.setOnboardingStatus(employeeId, "IN_PROGRESS");

  await recordAuditLog(ctx, {
    action: "employee.onboarding_started",
    entityType: "employee",
    entityId: employeeId,
  });

  return (await employeeOnboardingRepository.findByEmployee(employeeId))!;
}

export async function updateOnboardingTask(
  ctx: RequestContext,
  employeeId: string,
  taskId: string,
  isCompleted: boolean,
): Promise<EmployeeOnboardingWithTasks> {
  requirePermission(ctx, "employee.update");
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, employee.companyId);

  const onboarding = await employeeOnboardingRepository.findByEmployee(employeeId);
  if (!onboarding || !onboarding.tasks.some((t) => t.id === taskId)) {
    throw new OnboardingNotFoundError();
  }

  await employeeOnboardingTaskRepository.setCompleted(taskId, isCompleted);
  const remaining = await employeeOnboardingTaskRepository.countIncomplete(onboarding.id);

  if (remaining === 0) {
    await employeeOnboardingRepository.markCompleted(onboarding.id);
    await employeeRepository.setOnboardingStatus(employeeId, "COMPLETED");
  } else if (employee.onboardingStatus === "COMPLETED") {
    // Un-completing a task after the checklist was fully done moves it back to in-progress.
    await employeeRepository.setOnboardingStatus(employeeId, "IN_PROGRESS");
  }

  await recordAuditLog(ctx, {
    action: "employee.onboarding_task_updated",
    entityType: "employee",
    entityId: employeeId,
    metadata: { taskId, isCompleted },
  });

  return (await employeeOnboardingRepository.findByEmployee(employeeId))!;
}

/**
 * Returns one hierarchy level at a time (the top level when `managerId` is null, or one
 * manager's direct reports) — the org chart UI fetches a subtree only when the user expands a
 * node, so this never loads the whole company tree in one call, however large the org is.
 */
export async function getOrgChartSubtree(ctx: RequestContext, managerId: string | null): Promise<OrgChartNode[]> {
  requirePermission(ctx, "employee.view");
  const scope = await getEmployeeScope(ctx);

  if (managerId) {
    const manager = await employeeRepository.findById(managerId);
    if (!manager) throw new EmployeeNotFoundError();
    assertCompanyAccess(ctx, manager.companyId);
    if (scope && !scope.has(managerId)) throw new AuthorizationError("This employee is outside your team.");
  }

  // A MANAGER's chart starts at themself and shows only their own line; other roles see the whole company.
  const fullLevel = await employeeRepository.listOrgChartLevel(ctx.companyId, managerId);
  const level = scope ? fullLevel.filter((e) => (managerId === null ? e.id === ctx.employeeId : scope.has(e.id))) : fullLevel;
  const counts = await employeeRepository.countDirectReportsForManagers(level.map((e) => e.id));

  return level.map((e) => ({
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    photoStorageKey: e.photoStorageKey,
    designationName: e.designation?.name ?? null,
    departmentName: e.department?.name ?? null,
    directReportCount: counts.get(e.id) ?? 0,
  }));
}

function computeExpiryStatus(expiryDate: string | null, warningDays = DEFAULT_EXPIRY_WARNING_DAYS): DocumentExpiryStatus {
  if (!expiryDate) return "NO_EXPIRY";
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const expiry = new Date(`${expiryDate}T00:00:00Z`);
  const diffDays = Math.floor((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return "EXPIRED";
  if (diffDays <= warningDays) return "EXPIRING_SOON";
  return "VALID";
}

function toDocumentSummary(document: EmployeeDocument): EmployeeDocumentSummary {
  const { storageKey: _storageKey, ...rest } = document;
  return { ...rest, expiryStatus: computeExpiryStatus(document.expiryDate) };
}

async function assertCanAccessEmployeeDocuments(ctx: RequestContext, employeeId: string): Promise<Employee> {
  if (ctx.employeeId !== employeeId) requirePermission(ctx, "employee.view_documents"); // F-24: permission first
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, employee.companyId);
  // Self-access stays open; anyone else needs the dedicated document-view permission. `employee.view`
  // is deliberately NOT enough (a manager holds it) — documents are HR-only until team scoping exists.
  if (!isSelf(ctx, employee)) {
    requirePermission(ctx, "employee.view_documents");
  }
  return employee;
}

export async function listEmployeeDocuments(ctx: RequestContext, employeeId: string): Promise<EmployeeDocumentSummary[]> {
  await assertCanAccessEmployeeDocuments(ctx, employeeId);
  const documents = await employeeDocumentRepository.listByEmployee(employeeId);
  return documents.map(toDocumentSummary);
}

/**
 * Creates the document record and returns a short-lived presigned PUT URL — the browser then
 * uploads the file bytes directly to S3, never through this server. The `storageKey` is
 * deterministic from the document's own id, generated here (not left to the DB default) so it
 * can be embedded in the presigned URL before the row exists.
 */
export async function initiateEmployeeDocumentUpload(
  ctx: RequestContext,
  employeeId: string,
  input: CreateEmployeeDocumentInput,
): Promise<{ document: EmployeeDocumentSummary; uploadUrl: string }> {
  requirePermission(ctx, "employee.manage_documents");
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, employee.companyId);

  const documentId = crypto.randomUUID();
  const storageKey = storage.buildDocumentKey(ctx.companyId, employeeId, documentId, input.originalFilename);

  // Request the presigned URL BEFORE creating the row — if storage isn't configured or the
  // request fails, no DB record should be left behind pointing at a key that was never uploaded
  // to (an earlier version of this function did the insert first and leaked exactly that kind
  // of orphan row when storage was unavailable).
  const uploadUrl = await storage.getUploadUrl(storageKey, input.mimeType, input.sizeBytes);

  const document = await employeeDocumentRepository.create({
    id: documentId,
    companyId: ctx.companyId,
    employeeId,
    documentType: input.documentType,
    title: input.title,
    storageKey,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    issueDate: input.issueDate,
    expiryDate: input.expiryDate,
    uploadedByUserId: ctx.userId,
  });

  await recordAuditLog(ctx, {
    action: "employee.document_upload",
    entityType: "employee_document",
    entityId: document.id,
    newData: toDocumentSummary(document),
  });

  return { document: toDocumentSummary(document), uploadUrl };
}

export async function getEmployeeDocumentDownload(
  ctx: RequestContext,
  employeeId: string,
  documentId: string,
): Promise<{ body: ReadableStream; contentType: string; contentLength: number; filename: string }> {
  await assertCanAccessEmployeeDocuments(ctx, employeeId);

  const document = await employeeDocumentRepository.findById(documentId);
  if (!document || document.employeeId !== employeeId || document.isArchived) {
    throw new EmployeeDocumentNotFoundError();
  }

  const stream = await storage.getObjectStream(document.storageKey);

  await recordAuditLog(ctx, {
    action: "employee.document_download",
    entityType: "employee_document",
    entityId: document.id,
  });

  return { ...stream, filename: document.originalFilename };
}

export async function archiveEmployeeDocument(
  ctx: RequestContext,
  employeeId: string,
  documentId: string,
): Promise<EmployeeDocumentSummary> {
  requirePermission(ctx, "employee.manage_documents");
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, employee.companyId);

  const existing = await employeeDocumentRepository.findById(documentId);
  if (!existing || existing.employeeId !== employeeId) throw new EmployeeDocumentNotFoundError();

  const archived = await employeeDocumentRepository.setActive(documentId, true);

  await recordAuditLog(ctx, {
    action: "employee.document_archive",
    entityType: "employee_document",
    entityId: documentId,
    oldData: toDocumentSummary(existing),
    newData: toDocumentSummary(archived),
  });

  return toDocumentSummary(archived);
}
