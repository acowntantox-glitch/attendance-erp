import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/db/client";
import {
  employeeDocuments,
  employeeHistory,
  employeeNumberCounters,
  employeeOnboarding,
  employeeOnboardingTasks,
  employees,
} from "@/db/schema";
import type {
  CreateEmployeeInput,
  Employee,
  EmployeeListFilters,
  EmployeeWithRelations,
  UpdateEmployeeInput,
} from "./model";

function buildFilters(companyId: string, filters: Partial<EmployeeListFilters>) {
  const conditions = [eq(employees.companyId, companyId), eq(employees.isArchived, false)];

  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(employees.firstName, term),
        ilike(employees.lastName, term),
        ilike(employees.workEmail, term),
        ilike(employees.employeeNumber, term),
      )!,
    );
  }
  if (filters.departmentId) conditions.push(eq(employees.departmentId, filters.departmentId));
  if (filters.designationId) conditions.push(eq(employees.designationId, filters.designationId));
  if (filters.locationId) conditions.push(eq(employees.locationId, filters.locationId));
  if (filters.status) conditions.push(eq(employees.employmentStatus, filters.status));
  if (filters.employmentType) conditions.push(eq(employees.employmentType, filters.employmentType));
  if (filters.joinedFrom) conditions.push(gte(employees.dateOfJoining, filters.joinedFrom));
  if (filters.joinedTo) conditions.push(lte(employees.dateOfJoining, filters.joinedTo));

  return and(...conditions);
}

function sortColumn(sort: EmployeeListFilters["sort"]) {
  switch (sort) {
    case "name_desc":
      return [desc(employees.firstName), desc(employees.lastName)];
    case "joined_asc":
      return [asc(employees.dateOfJoining)];
    case "joined_desc":
      return [desc(employees.dateOfJoining)];
    case "employee_number_asc":
      return [asc(employees.employeeNumber)];
    case "name_asc":
    default:
      return [asc(employees.firstName), asc(employees.lastName)];
  }
}

export const employeeRepository = {
  findById(id: string) {
    return db.query.employees.findFirst({ where: eq(employees.id, id) });
  },
  findByIdWithRelations(id: string) {
    return db.query.employees.findFirst({
      where: eq(employees.id, id),
      with: { department: true, designation: true, location: true, manager: true },
    });
  },
  findByUserId(companyId: string, userId: string) {
    return db.query.employees.findFirst({
      where: and(eq(employees.companyId, companyId), eq(employees.userId, userId)),
    });
  },
  findByWorkEmail(companyId: string, workEmail: string) {
    return db.query.employees.findFirst({
      where: and(eq(employees.companyId, companyId), eq(employees.workEmail, workEmail)),
    });
  },
  async listByCompany(companyId: string, filters: EmployeeListFilters): Promise<EmployeeWithRelations[]> {
    const where = buildFilters(companyId, filters);
    // Single query with joins (not N+1) — the directory/profile need department/designation/
    // location/manager names, not just ids.
    return db.query.employees.findMany({
      where,
      orderBy: sortColumn(filters.sort),
      limit: filters.pageSize,
      offset: (filters.page - 1) * filters.pageSize,
      with: {
        department: { columns: { id: true, name: true } },
        designation: { columns: { id: true, name: true } },
        location: { columns: { id: true, name: true } },
        manager: { columns: { id: true, firstName: true, lastName: true } },
      },
    });
  },
  async countByCompany(companyId: string, filters: Partial<EmployeeListFilters>): Promise<number> {
    const where = buildFilters(companyId, filters);
    const [row] = await db.select({ value: count() }).from(employees).where(where);
    return row?.value ?? 0;
  },
  listDirectReports(managerId: string) {
    return db.query.employees.findMany({
      where: and(eq(employees.managerId, managerId), eq(employees.isArchived, false)),
    });
  },
  /** Org chart node data: one hierarchy level (either the top level or one manager's direct
   *  reports), each with its designation/department name and its own direct-report count so the
   *  UI knows whether to render an expand affordance — without ever fetching the whole tree. */
  listOrgChartLevel(companyId: string, managerId: string | null) {
    return db.query.employees.findMany({
      where: and(
        eq(employees.companyId, companyId),
        eq(employees.isArchived, false),
        managerId ? eq(employees.managerId, managerId) : isNull(employees.managerId),
      ),
      orderBy: [asc(employees.firstName), asc(employees.lastName)],
      columns: { id: true, firstName: true, lastName: true, photoStorageKey: true },
      with: {
        designation: { columns: { name: true } },
        department: { columns: { name: true } },
      },
    });
  },
  async countActiveDirectReports(managerId: string, executor: DbExecutor = db): Promise<number> {
    const [row] = await executor
      .select({ value: count() })
      .from(employees)
      .where(and(eq(employees.managerId, managerId), eq(employees.isArchived, false)));
    return row?.value ?? 0;
  },
  /** One grouped query, not N+1 — used by the org chart to show an expand affordance on each
   *  node in a level without a per-node round trip. */
  async countDirectReportsForManagers(managerIds: string[]): Promise<Map<string, number>> {
    if (managerIds.length === 0) return new Map();
    const rows = await db
      .select({ managerId: employees.managerId, value: count() })
      .from(employees)
      .where(and(inArray(employees.managerId, managerIds), eq(employees.isArchived, false)))
      .groupBy(employees.managerId);
    return new Map(rows.filter((r) => r.managerId !== null).map((r) => [r.managerId as string, r.value]));
  },
  async existsActiveInDepartment(departmentId: string): Promise<boolean> {
    const [row] = await db
      .select({ value: count() })
      .from(employees)
      .where(and(eq(employees.departmentId, departmentId), eq(employees.isArchived, false)));
    return (row?.value ?? 0) > 0;
  },
  async existsActiveInDesignation(designationId: string): Promise<boolean> {
    const [row] = await db
      .select({ value: count() })
      .from(employees)
      .where(and(eq(employees.designationId, designationId), eq(employees.isArchived, false)));
    return (row?.value ?? 0) > 0;
  },
  async existsActiveAtLocation(locationId: string): Promise<boolean> {
    const [row] = await db
      .select({ value: count() })
      .from(employees)
      .where(and(eq(employees.locationId, locationId), eq(employees.isArchived, false)));
    return (row?.value ?? 0) > 0;
  },
  create(
    tx: DbExecutor,
    companyId: string,
    input: CreateEmployeeInput & { employeeNumber: string; createdByUserId?: string; updatedByUserId?: string },
  ) {
    return tx
      .insert(employees)
      .values({ companyId, ...input })
      .returning()
      .then((rows) => rows[0]!);
  },
  update(id: string, input: UpdateEmployeeInput & { updatedByUserId?: string }, executor: DbExecutor = db) {
    return executor
      .update(employees)
      .set(input)
      .where(eq(employees.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
  setActive(id: string, isArchived: boolean, executor: DbExecutor = db) {
    return executor
      .update(employees)
      .set({ isArchived, archivedAt: isArchived ? sql`now()` : null })
      .where(eq(employees.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
  setEmploymentStatus(
    id: string,
    employmentStatus: Employee["employmentStatus"],
    updatedByUserId?: string,
    executor: DbExecutor = db,
  ) {
    return executor
      .update(employees)
      .set({ employmentStatus, updatedByUserId })
      .where(eq(employees.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
  setOnboardingStatus(id: string, onboardingStatus: Employee["onboardingStatus"]) {
    return db
      .update(employees)
      .set({ onboardingStatus })
      .where(eq(employees.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
  getCounts(companyId: string) {
    return db
      .select({
        total: count(),
        active: count(sql`case when ${employees.employmentStatus} = 'ACTIVE' then 1 end`),
        probation: count(sql`case when ${employees.employmentStatus} = 'PROBATION' then 1 end`),
        noticePeriod: count(sql`case when ${employees.employmentStatus} = 'NOTICE_PERIOD' then 1 end`),
      })
      .from(employees)
      .where(and(eq(employees.companyId, companyId), eq(employees.isArchived, false)))
      .then((rows) => rows[0]!);
  },
  countNewJoinersSince(companyId: string, sinceDate: string) {
    return db
      .select({ value: count() })
      .from(employees)
      .where(
        and(eq(employees.companyId, companyId), eq(employees.isArchived, false), gte(employees.dateOfJoining, sinceDate)),
      )
      .then((rows) => rows[0]?.value ?? 0);
  },
};

export const employeeNumberCounterRepository = {
  /**
   * Atomic per-company counter: `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` is a single
   * statement, so two concurrent calls for the same company serialize on Postgres's row-level
   * lock for the conflicting row and always return distinct values — no SELECT ... FOR UPDATE
   * or advisory lock needed. Must be called inside the same transaction as the employee insert
   * so a validation failure (e.g. duplicate work email) rolls the counter increment back too.
   */
  async issueNextNumber(tx: DbExecutor, companyId: string): Promise<string> {
    const [row] = await tx
      .insert(employeeNumberCounters)
      .values({ companyId, nextNumber: 2 })
      .onConflictDoUpdate({
        target: employeeNumberCounters.companyId,
        set: { nextNumber: sql`${employeeNumberCounters.nextNumber} + 1`, updatedAt: sql`now()` },
      })
      .returning({ nextNumber: employeeNumberCounters.nextNumber });

    const issued = row!.nextNumber - 1;
    return `EMP-${String(issued).padStart(5, "0")}`;
  },
};

export const employeeHistoryRepository = {
  listByEmployee(employeeId: string) {
    return db.query.employeeHistory.findMany({
      where: eq(employeeHistory.employeeId, employeeId),
      orderBy: desc(employeeHistory.createdAt),
    });
  },
  /** Always called with the same `tx` as the employee write it's recording, so a rollback
   *  (e.g. a duplicate-email failure) undoes the history row too — this is structured business
   *  data, not the best-effort technical audit log, so it must be atomic with the change it
   *  describes. */
  create(tx: DbExecutor, entry: typeof employeeHistory.$inferInsert) {
    return tx
      .insert(employeeHistory)
      .values(entry)
      .returning()
      .then((rows) => rows[0]!);
  },
};

export const employeeOnboardingRepository = {
  findByEmployee(employeeId: string) {
    return db.query.employeeOnboarding.findFirst({
      where: eq(employeeOnboarding.employeeId, employeeId),
      with: { tasks: { orderBy: (t, { asc: ascOrder }) => ascOrder(t.sortOrder) } },
    });
  },
  create(employeeId: string, startedAt: Date) {
    return db
      .insert(employeeOnboarding)
      .values({ employeeId, startedAt })
      .returning()
      .then((rows) => rows[0]!);
  },
  markCompleted(id: string) {
    return db
      .update(employeeOnboarding)
      .set({ completedAt: sql`now()` })
      .where(eq(employeeOnboarding.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
};

export const employeeOnboardingTaskRepository = {
  createMany(onboardingId: string, labels: string[]) {
    return db
      .insert(employeeOnboardingTasks)
      .values(labels.map((label, index) => ({ onboardingId, label, sortOrder: index })))
      .returning();
  },
  findById(id: string) {
    return db.query.employeeOnboardingTasks.findFirst({ where: eq(employeeOnboardingTasks.id, id) });
  },
  setCompleted(id: string, isCompleted: boolean) {
    return db
      .update(employeeOnboardingTasks)
      .set({ isCompleted, completedAt: isCompleted ? sql`now()` : null })
      .where(eq(employeeOnboardingTasks.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
  async countIncomplete(onboardingId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(employeeOnboardingTasks)
      .where(and(eq(employeeOnboardingTasks.onboardingId, onboardingId), eq(employeeOnboardingTasks.isCompleted, false)));
    return row?.value ?? 0;
  },
};

export const employeeDocumentRepository = {
  findById(id: string) {
    return db.query.employeeDocuments.findFirst({ where: eq(employeeDocuments.id, id) });
  },
  listByEmployee(employeeId: string) {
    return db.query.employeeDocuments.findMany({
      where: and(eq(employeeDocuments.employeeId, employeeId), eq(employeeDocuments.isArchived, false)),
      orderBy: desc(employeeDocuments.createdAt),
    });
  },
  create(entry: typeof employeeDocuments.$inferInsert) {
    return db
      .insert(employeeDocuments)
      .values(entry)
      .returning()
      .then((rows) => rows[0]!);
  },
  setActive(id: string, isArchived: boolean) {
    return db
      .update(employeeDocuments)
      .set({ isArchived })
      .where(eq(employeeDocuments.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
};
