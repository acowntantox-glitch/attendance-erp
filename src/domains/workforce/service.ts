import { db } from "@/db/client";
import type { RequestContext } from "@/lib/auth/request-context";
import { assertCompanyAccess, requirePermission } from "@/lib/auth/request-context";
import { AuthorizationError, BusinessRuleError, isUniqueViolation } from "@/lib/errors";
import { recordAuditLog } from "@/domains/audit/service";
import { employeeRepository } from "@/domains/employee/repository";
import { EmployeeNotFoundError } from "@/domains/employee/errors";
import { branchRepository, companyRepository } from "@/domains/organization/repository";
import { BranchNotFoundError } from "@/domains/organization/errors";
import { addDays, computeExpectedWindow, dayOfWeekInZone, enumerateDateRange, resolveTimezone } from "@/lib/datetime";
import {
  employeeScheduleAssignmentRepository,
  holidayRepository,
  shiftRepository,
  weeklyOffRuleRepository,
  workforceEmployeeRepository,
  workScheduleRepository,
} from "./repository";
import {
  DuplicateHolidayError,
  DuplicateShiftCodeError,
  DuplicateWorkScheduleNameError,
  EmployeeScheduleAssignmentNotFoundError,
  HolidayNotFoundError,
  ImmutableAssignmentFieldError,
  OverlappingScheduleAssignmentError,
  OverlappingWeeklyOffOverrideError,
  ScheduleHasActiveAssignmentsError,
  ShiftHasActiveAssignmentsError,
  ShiftNotFoundError,
  WorkScheduleNotFoundError,
} from "./errors";
import type {
  AssignEmployeeScheduleInput,
  CreateHolidayInput,
  CreateShiftInput,
  CreateWorkScheduleInput,
  EmployeeScheduleAssignment,
  EmployeeScheduleAssignmentWithHistory,
  Holiday,
  Shift,
  SetWeeklyOffRuleInput,
  UpdateEmployeeScheduleAssignmentInput,
  UpdateHolidayInput,
  UpdateShiftInput,
  UpdateWorkScheduleInput,
  WeeklyOffRule,
  WeeklyOffSource,
  WorkforceDashboardSummary,
  WorkforceDayInfo,
  WorkSchedule,
} from "./model";

// ---------------------------------------------------------------------------
// Work Schedules
// ---------------------------------------------------------------------------

export async function listWorkSchedules(ctx: RequestContext): Promise<WorkSchedule[]> {
  requirePermission(ctx, "schedule.view");
  return workScheduleRepository.listByCompany(ctx.companyId);
}

export async function getWorkSchedule(ctx: RequestContext, id: string): Promise<WorkSchedule> {
  requirePermission(ctx, "schedule.view");
  const schedule = await workScheduleRepository.findById(id);
  if (!schedule) throw new WorkScheduleNotFoundError();
  assertCompanyAccess(ctx, schedule.companyId);
  return schedule;
}

export async function createWorkSchedule(ctx: RequestContext, input: CreateWorkScheduleInput): Promise<WorkSchedule> {
  requirePermission(ctx, "schedule.create");
  try {
    const schedule = await workScheduleRepository.create(ctx.companyId, input);
    await recordAuditLog(ctx, { action: "work_schedule.create", entityType: "work_schedule", entityId: schedule.id, newData: schedule });
    return schedule;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateWorkScheduleNameError(input.name);
    throw error;
  }
}

export async function updateWorkSchedule(
  ctx: RequestContext,
  id: string,
  input: UpdateWorkScheduleInput,
): Promise<WorkSchedule> {
  requirePermission(ctx, "schedule.update");
  const existing = await workScheduleRepository.findById(id);
  if (!existing) throw new WorkScheduleNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  try {
    const schedule = await workScheduleRepository.update(id, input);
    await recordAuditLog(ctx, {
      action: "work_schedule.update",
      entityType: "work_schedule",
      entityId: schedule.id,
      oldData: existing,
      newData: schedule,
    });
    return schedule;
  } catch (error) {
    if (isUniqueViolation(error) && input.name) throw new DuplicateWorkScheduleNameError(input.name);
    throw error;
  }
}

export async function setWorkScheduleActive(ctx: RequestContext, id: string, isActive: boolean): Promise<WorkSchedule> {
  requirePermission(ctx, "schedule.archive");
  const existing = await workScheduleRepository.findById(id);
  if (!existing) throw new WorkScheduleNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  if (!isActive && (await workScheduleRepository.countActiveAssignments(id)) > 0) {
    throw new ScheduleHasActiveAssignmentsError();
  }

  const schedule = await workScheduleRepository.setActive(id, isActive);
  await recordAuditLog(ctx, {
    action: isActive ? "work_schedule.restore" : "work_schedule.archive",
    entityType: "work_schedule",
    entityId: schedule.id,
    oldData: existing,
    newData: schedule,
  });
  return schedule;
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

export async function listShifts(ctx: RequestContext): Promise<Shift[]> {
  requirePermission(ctx, "shift.view");
  return shiftRepository.listByCompany(ctx.companyId);
}

export async function getShift(ctx: RequestContext, id: string): Promise<Shift> {
  requirePermission(ctx, "shift.view");
  const shift = await shiftRepository.findById(id);
  if (!shift) throw new ShiftNotFoundError();
  assertCompanyAccess(ctx, shift.companyId);
  return shift;
}

export async function createShift(ctx: RequestContext, input: CreateShiftInput): Promise<Shift> {
  requirePermission(ctx, "shift.create");
  try {
    const shift = await shiftRepository.create(ctx.companyId, input);
    await recordAuditLog(ctx, { action: "shift.create", entityType: "shift", entityId: shift.id, newData: shift });
    return shift;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateShiftCodeError(input.code);
    throw error;
  }
}

export async function updateShift(ctx: RequestContext, id: string, input: UpdateShiftInput): Promise<Shift> {
  requirePermission(ctx, "shift.update");
  const existing = await shiftRepository.findById(id);
  if (!existing) throw new ShiftNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  const shift = await shiftRepository.update(id, input);
  await recordAuditLog(ctx, {
    action: "shift.update",
    entityType: "shift",
    entityId: shift.id,
    oldData: existing,
    newData: shift,
  });
  return shift;
}

export async function setShiftActive(ctx: RequestContext, id: string, isActive: boolean): Promise<Shift> {
  requirePermission(ctx, "shift.archive");
  const existing = await shiftRepository.findById(id);
  if (!existing) throw new ShiftNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  if (!isActive && (await shiftRepository.countActiveAssignments(id)) > 0) {
    throw new ShiftHasActiveAssignmentsError();
  }

  const shift = await shiftRepository.setActive(id, isActive);
  await recordAuditLog(ctx, {
    action: isActive ? "shift.restore" : "shift.archive",
    entityType: "shift",
    entityId: shift.id,
    oldData: existing,
    newData: shift,
  });
  return shift;
}

// ---------------------------------------------------------------------------
// Employee Schedule Assignments
// ---------------------------------------------------------------------------

async function loadEmployeeInCompany(ctx: RequestContext, employeeId: string) {
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, employee.companyId);
  return employee;
}

function isSelfEmployee(ctx: RequestContext, employeeId: string): boolean {
  return ctx.employeeId !== null && ctx.employeeId === employeeId;
}

export async function listEmployeeScheduleAssignments(
  ctx: RequestContext,
  employeeId: string,
): Promise<EmployeeScheduleAssignmentWithHistory[]> {
  await loadEmployeeInCompany(ctx, employeeId);
  if (!isSelfEmployee(ctx, employeeId)) {
    requirePermission(ctx, "employee_schedule.view");
  }
  return employeeScheduleAssignmentRepository.listForEmployee(employeeId);
}

/**
 * Creates a new assignment, closing the employee's currently open one (if any) in the same
 * transaction. Existing rows are never mutated except to shorten `effectiveTo` — see
 * `updateEmployeeScheduleAssignment`. Overlap against any existing assignment (open or already
 * closed) is rejected unless the caller explicitly passes `allowOverlap: true`, which is always
 * audited with the `note` explaining why.
 */
export async function assignEmployeeSchedule(
  ctx: RequestContext,
  employeeId: string,
  input: AssignEmployeeScheduleInput,
): Promise<EmployeeScheduleAssignment> {
  requirePermission(ctx, "employee_schedule.create");
  const employee = await loadEmployeeInCompany(ctx, employeeId);

  const schedule = await workScheduleRepository.findById(input.workScheduleId);
  if (!schedule) throw new WorkScheduleNotFoundError();
  assertCompanyAccess(ctx, schedule.companyId);

  if (input.shiftId) {
    const shift = await shiftRepository.findById(input.shiftId);
    if (!shift) throw new ShiftNotFoundError();
    assertCompanyAccess(ctx, shift.companyId);
  }

  const assignment = await db.transaction(async (tx) => {
    const open = await employeeScheduleAssignmentRepository.findOpenForEmployee(employeeId, tx);
    // Only treat this as "start a new current assignment" (auto-closing the old one) when the
    // new range genuinely starts after the existing open one did. A new range starting on or
    // before the existing assignment's own start date isn't a simple forward transition — it's a
    // backdated conflict, so it falls through to the ordinary overlap check below instead of
    // being silently auto-closed (which could otherwise produce effectiveTo < effectiveFrom).
    const willAutoCloseOpen = Boolean(open && open.effectiveFrom < input.effectiveFrom);

    if (!input.allowOverlap) {
      const overlapping = await employeeScheduleAssignmentRepository.findOverlapping(
        employeeId,
        input.effectiveFrom,
        input.effectiveTo ?? null,
        tx,
      );
      const unresolved = overlapping.filter((a) => !(willAutoCloseOpen && a.id === open!.id));
      if (unresolved.length > 0) throw new OverlappingScheduleAssignmentError();
    }

    if (willAutoCloseOpen) {
      await employeeScheduleAssignmentRepository.closeAssignment(tx, open!.id, addDays(input.effectiveFrom, -1));
    }

    return employeeScheduleAssignmentRepository.create(tx, ctx.companyId, employeeId, {
      workScheduleId: input.workScheduleId,
      shiftId: input.shiftId ?? null,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      assignedByUserId: ctx.userId,
      note: input.note ?? null,
    });
  });

  await recordAuditLog(ctx, {
    action: "employee_schedule.assign",
    entityType: "employee_schedule_assignment",
    entityId: assignment.id,
    newData: assignment,
    metadata: { employeeId: employee.id, allowOverlap: Boolean(input.allowOverlap) },
  });
  return assignment;
}

/**
 * Only `effectiveTo` (early termination) and `note` can change on an existing assignment.
 * `employeeId`/`workScheduleId`/`shiftId`/`effectiveFrom` are immutable — see the module doc on
 * `employeeScheduleAssignments` in src/db/schema/workforce.ts for why.
 */
export async function updateEmployeeScheduleAssignment(
  ctx: RequestContext,
  assignmentId: string,
  input: UpdateEmployeeScheduleAssignmentInput,
): Promise<EmployeeScheduleAssignment> {
  requirePermission(ctx, "employee_schedule.update");
  const existing = await employeeScheduleAssignmentRepository.findById(assignmentId);
  if (!existing) throw new EmployeeScheduleAssignmentNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  if (input.effectiveTo !== undefined) {
    if (input.effectiveTo === null) {
      // Reopening a previously-closed assignment to open-ended is an extension (to infinity),
      // not a shortening — only a no-op on an already-open assignment is allowed.
      if (existing.effectiveTo !== null) throw new ImmutableAssignmentFieldError();
    } else {
      if (input.effectiveTo < existing.effectiveFrom) throw new ImmutableAssignmentFieldError();
      // Only shortening (or a no-op) is allowed — extending effectiveTo further into the future
      // than it currently is could silently overlap a later assignment for the same employee.
      if (existing.effectiveTo !== null && input.effectiveTo > existing.effectiveTo) {
        throw new ImmutableAssignmentFieldError();
      }
    }
  }

  const updated = await employeeScheduleAssignmentRepository.update(assignmentId, input);
  await recordAuditLog(ctx, {
    action: "employee_schedule.update",
    entityType: "employee_schedule_assignment",
    entityId: updated.id,
    oldData: existing,
    newData: updated,
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Weekly Off
// ---------------------------------------------------------------------------

export async function getCompanyDefaultWeeklyOff(ctx: RequestContext): Promise<WeeklyOffRule | null> {
  requirePermission(ctx, "weekly_off.view");
  return (await weeklyOffRuleRepository.findCompanyDefault(ctx.companyId)) ?? null;
}

/** Replaces the company default: deactivates the old one (if any) and inserts a new active row. */
export async function setCompanyDefaultWeeklyOff(ctx: RequestContext, input: SetWeeklyOffRuleInput): Promise<WeeklyOffRule> {
  requirePermission(ctx, "weekly_off.create");

  const rule = await db.transaction(async (tx) => {
    const existing = await weeklyOffRuleRepository.findCompanyDefault(ctx.companyId);
    if (existing) await weeklyOffRuleRepository.deactivate(existing.id, tx);
    return weeklyOffRuleRepository.create(
      {
        companyId: ctx.companyId,
        employeeId: null,
        offDays: input.offDays,
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveTo: input.effectiveTo ?? null,
      },
      tx,
    );
  });

  await recordAuditLog(ctx, { action: "weekly_off.set_default", entityType: "weekly_off_rule", entityId: rule.id, newData: rule });
  return rule;
}

export async function getEmployeeWeeklyOffOverride(ctx: RequestContext, employeeId: string): Promise<WeeklyOffRule | null> {
  await loadEmployeeInCompany(ctx, employeeId);
  if (!isSelfEmployee(ctx, employeeId)) {
    requirePermission(ctx, "weekly_off.view");
  }
  const today = new Date().toISOString().slice(0, 10);
  return (await weeklyOffRuleRepository.findActiveOverrideForEmployee(employeeId, today)) ?? null;
}

/**
 * Closes the employee's current open override (if any) and inserts a new one. Mirrors
 * `assignEmployeeSchedule`'s guard: the existing open override is only auto-closed when the new
 * one genuinely starts after it did — a new effective date on or before the existing override's
 * own start is a backdated conflict, not a simple forward transition, and would otherwise close
 * the old row with an effectiveTo earlier than its own effectiveFrom.
 */
export async function setEmployeeWeeklyOffOverride(
  ctx: RequestContext,
  employeeId: string,
  input: SetWeeklyOffRuleInput,
): Promise<WeeklyOffRule> {
  requirePermission(ctx, "weekly_off.create");
  const employee = await loadEmployeeInCompany(ctx, employeeId);
  const newEffectiveFrom = input.effectiveFrom ?? todayIso();

  const rule = await db.transaction(async (tx) => {
    const open = await weeklyOffRuleRepository.findOpenOverrideForEmployee(employeeId, tx);
    if (open) {
      // A null effectiveFrom means "always effective" (open at the start, not just the end) — so
      // any real new effective date is unambiguously "after" it.
      const openEffectiveFrom = open.effectiveFrom ?? "0001-01-01";
      if (openEffectiveFrom >= newEffectiveFrom) {
        throw new OverlappingWeeklyOffOverrideError();
      }
      await weeklyOffRuleRepository.closeEmployeeOverride(employeeId, addDays(newEffectiveFrom, -1), tx);
    }
    return weeklyOffRuleRepository.create(
      {
        companyId: ctx.companyId,
        employeeId: employee.id,
        offDays: input.offDays,
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveTo: input.effectiveTo ?? null,
      },
      tx,
    );
  });

  await recordAuditLog(ctx, {
    action: "weekly_off.set_override",
    entityType: "weekly_off_rule",
    entityId: rule.id,
    newData: rule,
    metadata: { employeeId },
  });
  return rule;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

export async function listHolidays(ctx: RequestContext, from: string, to: string): Promise<Holiday[]> {
  requirePermission(ctx, "holiday.view");
  return holidayRepository.listByCompanyInRange(ctx.companyId, from, to);
}

export async function getHoliday(ctx: RequestContext, id: string): Promise<Holiday> {
  requirePermission(ctx, "holiday.view");
  const holiday = await holidayRepository.findById(id);
  if (!holiday) throw new HolidayNotFoundError();
  assertCompanyAccess(ctx, holiday.companyId);
  return holiday;
}

export async function createHoliday(ctx: RequestContext, input: CreateHolidayInput): Promise<Holiday> {
  requirePermission(ctx, "holiday.create");

  if (input.branchId) {
    const branch = await branchRepository.findById(input.branchId);
    if (!branch) throw new BranchNotFoundError();
    assertCompanyAccess(ctx, branch.companyId);
  }

  try {
    const holiday = await holidayRepository.create(ctx.companyId, { ...input, createdByUserId: ctx.userId });
    await recordAuditLog(ctx, { action: "holiday.create", entityType: "holiday", entityId: holiday.id, newData: holiday });
    return holiday;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateHolidayError();
    throw error;
  }
}

export async function updateHoliday(ctx: RequestContext, id: string, input: UpdateHolidayInput): Promise<Holiday> {
  requirePermission(ctx, "holiday.update");
  const existing = await holidayRepository.findById(id);
  if (!existing) throw new HolidayNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  const holiday = await holidayRepository.update(id, input);
  await recordAuditLog(ctx, {
    action: "holiday.update",
    entityType: "holiday",
    entityId: holiday.id,
    oldData: existing,
    newData: holiday,
  });
  return holiday;
}

export async function setHolidayActive(ctx: RequestContext, id: string, isActive: boolean): Promise<Holiday> {
  requirePermission(ctx, "holiday.archive");
  const existing = await holidayRepository.findById(id);
  if (!existing) throw new HolidayNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  const holiday = await holidayRepository.setActive(id, isActive);
  await recordAuditLog(ctx, {
    action: isActive ? "holiday.restore" : "holiday.archive",
    entityType: "holiday",
    entityId: holiday.id,
    oldData: existing,
    newData: holiday,
  });
  return holiday;
}

// ---------------------------------------------------------------------------
// Workforce Calendar — the single, reusable "what applied to this employee on this date"
// calculation. Attendance (built later) imports this directly instead of re-implementing any of
// it, per the documented domain rule that Workforce owns this logic and Attendance only consumes
// it (docs/architecture/attendance-architecture.md).
// ---------------------------------------------------------------------------

/**
 * The same branch -> company timezone resolution chain `getWorkforceDayInfo` uses internally,
 * exposed standalone for Attendance: it needs an employee's local calendar date (to know *which*
 * date to ask `getWorkforceDayInfo` about) before it has any assignment/date-specific info to work
 * with. Additive only — does not change any existing Workforce behavior.
 */
export async function resolveEmployeeTimezone(ctx: RequestContext, employeeId: string): Promise<string> {
  const employee = await loadEmployeeInCompany(ctx, employeeId);
  const [company, branch] = await Promise.all([
    companyRepository.findById(ctx.companyId),
    employee.locationId ? branchRepository.findById(employee.locationId) : Promise.resolve(null),
  ]);
  if (!company) throw new Error("Company not found for an authenticated request context.");
  return resolveTimezone(branch?.timezone, company.timezone);
}

export async function getWorkforceDayInfo(ctx: RequestContext, employeeId: string, date: string): Promise<WorkforceDayInfo> {
  requirePermission(ctx, "workforce_calendar.view");
  // An EMPLOYEE can only ever see their own day — the permission is granted company-wide but the
  // service layer pins the target to the caller's own record for this role, never the client's.
  // If this account has no linked employee record at all, there is no "own day" to pin to —
  // reject rather than silently falling through to the client-supplied employeeId (which would
  // let such an account view any employee's schedule/shift within the company).
  if (ctx.role === "EMPLOYEE" && !ctx.employeeId) {
    throw new AuthorizationError("No employee record is linked to this account.");
  }
  const targetEmployeeId = ctx.role === "EMPLOYEE" ? ctx.employeeId! : employeeId;

  const employee = await loadEmployeeInCompany(ctx, targetEmployeeId);
  const [company, branch] = await Promise.all([
    companyRepository.findById(ctx.companyId),
    employee.locationId ? branchRepository.findById(employee.locationId) : Promise.resolve(null),
  ]);
  if (!company) throw new Error("Company not found for an authenticated request context.");

  // Step 1: holiday short-circuits everything else.
  const holiday = await holidayRepository.findActiveForDate(ctx.companyId, employee.locationId, date);
  if (holiday) {
    return {
      date,
      employeeId: targetEmployeeId,
      companyId: ctx.companyId,
      timezone: resolveTimezone(branch?.timezone, company.timezone),
      isHoliday: true,
      holiday,
      isWeeklyOff: false,
      weeklyOffSource: "none",
      scheduleAssignment: null,
      isWorkingDay: false,
      expectedWindow: null,
    };
  }

  // Step 2: weekly off — employee override takes precedence over the company default.
  const timezone = resolveTimezone(branch?.timezone, company.timezone);
  const dow = dayOfWeekInZone(new Date(`${date}T12:00:00Z`), timezone);

  const override = await weeklyOffRuleRepository.findActiveOverrideForEmployee(targetEmployeeId, date);
  let isWeeklyOff = false;
  let weeklyOffSource: WeeklyOffSource = "none";
  if (override) {
    isWeeklyOff = override.offDays.includes(dow);
    weeklyOffSource = "employee_override";
  } else {
    const companyDefault = await weeklyOffRuleRepository.findCompanyDefault(ctx.companyId);
    if (companyDefault) {
      isWeeklyOff = companyDefault.offDays.includes(dow);
      weeklyOffSource = "company_default";
    }
  }

  if (isWeeklyOff) {
    return {
      date,
      employeeId: targetEmployeeId,
      companyId: ctx.companyId,
      timezone,
      isHoliday: false,
      holiday: null,
      isWeeklyOff: true,
      weeklyOffSource,
      scheduleAssignment: null,
      isWorkingDay: false,
      expectedWindow: null,
    };
  }

  // Step 3: resolve the schedule assignment covering this date, if any.
  const assignment = await employeeScheduleAssignmentRepository.findCoveringDate(targetEmployeeId, date);
  if (!assignment) {
    return {
      date,
      employeeId: targetEmployeeId,
      companyId: ctx.companyId,
      timezone,
      isHoliday: false,
      holiday: null,
      isWeeklyOff: false,
      weeklyOffSource,
      scheduleAssignment: null,
      isWorkingDay: true,
      expectedWindow: null,
    };
  }

  const source = assignment.shift ?? assignment.workSchedule;
  const resolvedTimezone = assignment.shift ? timezone : resolveTimezone(assignment.workSchedule.timezone, branch?.timezone, company.timezone);
  const window = computeExpectedWindow(date, source.startTime, source.endTime);

  return {
    date,
    employeeId: targetEmployeeId,
    companyId: ctx.companyId,
    timezone: resolvedTimezone,
    isHoliday: false,
    holiday: null,
    isWeeklyOff: false,
    weeklyOffSource,
    scheduleAssignment: assignment,
    isWorkingDay: true,
    expectedWindow: {
      ...window,
      breakDurationMinutes: source.breakDurationMinutes,
      breakStartTime: source.breakStartTime,
      isBreakPaid: source.isBreakPaid,
    },
  };
}

/** A month grid (padded to full weeks either side) is comfortably under this even at its widest
 *  (6 weeks = 42 days); the cap exists to reject anything resembling an unbounded/year-scale
 *  request, not to constrain a normal calendar view. */
export const MAX_CALENDAR_RANGE_DAYS = 45;

/**
 * The range/batch form of `getWorkforceDayInfo` for calendar views — deliberately calls it once
 * per date rather than re-implementing any of its precedence logic, so there is exactly one
 * holiday -> weekly-off -> schedule-assignment implementation in the codebase. This is an N-query
 * loop (same trade-off already made for the dashboard summary): correctness and a single source
 * of truth come first; revisit with a bulk query only if this becomes a measured bottleneck.
 */
export async function getWorkforceDayInfoRange(
  ctx: RequestContext,
  employeeId: string,
  from: string,
  to: string,
): Promise<WorkforceDayInfo[]> {
  const dates = enumerateDateRange(from, to);
  if (dates.length === 0) {
    throw new BusinessRuleError("'to' must be on or after 'from'.");
  }
  if (dates.length > MAX_CALENDAR_RANGE_DAYS) {
    throw new BusinessRuleError(`Calendar ranges cannot exceed ${MAX_CALENDAR_RANGE_DAYS} days.`);
  }
  return Promise.all(dates.map((date) => getWorkforceDayInfo(ctx, employeeId, date)));
}

// ---------------------------------------------------------------------------
// Workforce Dashboard — deliberately built on top of `getWorkforceDayInfo` (looping over active
// employees) rather than a separate hand-rolled bulk SQL implementation of the same precedence
// rules, even though that loop is less efficient: correctness of the core calculation comes
// first, and a second implementation that has to be kept in sync by hand is exactly the kind of
// duplication the calendar service exists to avoid. Revisit with a bulk query if/when employee
// counts make this a real bottleneck.
// ---------------------------------------------------------------------------

export async function getWorkforceDashboardSummary(ctx: RequestContext, date?: string): Promise<WorkforceDashboardSummary> {
  requirePermission(ctx, "workforce_dashboard.view");
  const today = date ?? todayIso();

  const employeeIds = await workforceEmployeeRepository.listActiveIds(ctx.companyId);
  const dayInfos = await Promise.all(employeeIds.map(({ id }) => getWorkforceDayInfo(ctx, id, today)));

  const employeesScheduledToday = dayInfos.filter((info) => info.isWorkingDay).length;
  const employeesOffToday = dayInfos.filter((info) => info.isWeeklyOff).length;
  const employeesOnHolidayToday = dayInfos.filter((info) => info.isHoliday).length;

  const activeShiftCount = await shiftRepository.countActive(ctx.companyId);
  const upcomingScheduleChanges = await employeeScheduleAssignmentRepository.listUpcoming(
    ctx.companyId,
    addDays(today, 1),
    addDays(today, 14),
  );

  return {
    date: today,
    employeesScheduledToday,
    employeesOffToday,
    employeesOnHolidayToday,
    activeShiftCount,
    upcomingScheduleChanges,
  };
}
