import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/db/client";
import { employeeScheduleAssignments, employees, holidays, shifts, weeklyOffRules, workSchedules } from "@/db/schema";
import type {
  CreateHolidayInput,
  CreateShiftInput,
  CreateWorkScheduleInput,
  UpdateHolidayInput,
  UpdateShiftInput,
  UpdateWorkScheduleInput,
} from "./model";

export const workScheduleRepository = {
  findById(id: string) {
    return db.query.workSchedules.findFirst({ where: eq(workSchedules.id, id) });
  },
  listByCompany(companyId: string) {
    return db.query.workSchedules.findMany({
      where: eq(workSchedules.companyId, companyId),
      orderBy: asc(workSchedules.name),
    });
  },
  create(companyId: string, input: CreateWorkScheduleInput) {
    return db
      .insert(workSchedules)
      .values({ companyId, ...input })
      .returning()
      .then((rows) => rows[0]!);
  },
  update(id: string, input: UpdateWorkScheduleInput) {
    return db
      .update(workSchedules)
      .set(input)
      .where(eq(workSchedules.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
  setActive(id: string, isActive: boolean) {
    return db
      .update(workSchedules)
      .set({ isActive })
      .where(eq(workSchedules.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
  countActiveAssignments(workScheduleId: string): Promise<number> {
    return db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeeScheduleAssignments)
      .where(and(eq(employeeScheduleAssignments.workScheduleId, workScheduleId), isNull(employeeScheduleAssignments.effectiveTo)))
      .then((rows) => rows[0]?.count ?? 0);
  },
};

export const shiftRepository = {
  findById(id: string) {
    return db.query.shifts.findFirst({ where: eq(shifts.id, id) });
  },
  findByCode(companyId: string, code: string) {
    return db.query.shifts.findFirst({ where: and(eq(shifts.companyId, companyId), eq(shifts.code, code)) });
  },
  listByCompany(companyId: string) {
    return db.query.shifts.findMany({ where: eq(shifts.companyId, companyId), orderBy: asc(shifts.name) });
  },
  countActive(companyId: string): Promise<number> {
    return db
      .select({ count: sql<number>`count(*)::int` })
      .from(shifts)
      .where(and(eq(shifts.companyId, companyId), eq(shifts.isActive, true)))
      .then((rows) => rows[0]?.count ?? 0);
  },
  create(companyId: string, input: CreateShiftInput) {
    return db
      .insert(shifts)
      .values({ companyId, ...input })
      .returning()
      .then((rows) => rows[0]!);
  },
  update(id: string, input: UpdateShiftInput) {
    return db
      .update(shifts)
      .set(input)
      .where(eq(shifts.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
  setActive(id: string, isActive: boolean) {
    return db
      .update(shifts)
      .set({ isActive })
      .where(eq(shifts.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
  countActiveAssignments(shiftId: string): Promise<number> {
    return db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeeScheduleAssignments)
      .where(and(eq(employeeScheduleAssignments.shiftId, shiftId), isNull(employeeScheduleAssignments.effectiveTo)))
      .then((rows) => rows[0]?.count ?? 0);
  },
};

export const employeeScheduleAssignmentRepository = {
  findById(id: string) {
    return db.query.employeeScheduleAssignments.findFirst({
      where: eq(employeeScheduleAssignments.id, id),
      with: { workSchedule: true, shift: true },
    });
  },
  /** The currently open-ended assignment for this employee, if any — at most one can exist. */
  findOpenForEmployee(employeeId: string, executor: DbExecutor = db) {
    return executor.query.employeeScheduleAssignments.findFirst({
      where: and(eq(employeeScheduleAssignments.employeeId, employeeId), isNull(employeeScheduleAssignments.effectiveTo)),
    });
  },
  /** Whatever assignment (open or closed) covers this exact date, for the "what applied on X" query. */
  findCoveringDate(employeeId: string, date: string) {
    return db.query.employeeScheduleAssignments.findFirst({
      where: and(
        eq(employeeScheduleAssignments.employeeId, employeeId),
        lte(employeeScheduleAssignments.effectiveFrom, date),
        or(isNull(employeeScheduleAssignments.effectiveTo), gte(employeeScheduleAssignments.effectiveTo, date)),
      ),
      orderBy: desc(employeeScheduleAssignments.effectiveFrom),
      with: { workSchedule: true, shift: true },
    });
  },
  /** Any existing assignment for this employee whose range intersects [from, to] (to may be open-ended). */
  findOverlapping(employeeId: string, from: string, to: string | null, executor: DbExecutor = db) {
    return executor.query.employeeScheduleAssignments.findMany({
      where: and(
        eq(employeeScheduleAssignments.employeeId, employeeId),
        // existing.effectiveFrom <= newTo (or newTo is open-ended, i.e. always true)
        to ? lte(employeeScheduleAssignments.effectiveFrom, to) : undefined,
        // existing.effectiveTo is open-ended OR existing.effectiveTo >= newFrom
        or(isNull(employeeScheduleAssignments.effectiveTo), gte(employeeScheduleAssignments.effectiveTo, from)),
      ),
    });
  },
  listForEmployee(employeeId: string) {
    return db.query.employeeScheduleAssignments.findMany({
      where: eq(employeeScheduleAssignments.employeeId, employeeId),
      orderBy: desc(employeeScheduleAssignments.effectiveFrom),
      // Includes who assigned it — the employee profile's assignment history needs a name, not
      // just a raw assignedByUserId. Display concern only, same rationale as listUpcoming below.
      with: { workSchedule: true, shift: true, assignedBy: { columns: { id: true, fullName: true } } },
    });
  },
  listUpcoming(companyId: string, fromDate: string, toDate: string) {
    return db.query.employeeScheduleAssignments.findMany({
      where: and(
        eq(employeeScheduleAssignments.companyId, companyId),
        gte(employeeScheduleAssignments.effectiveFrom, fromDate),
        lte(employeeScheduleAssignments.effectiveFrom, toDate),
      ),
      orderBy: asc(employeeScheduleAssignments.effectiveFrom),
      // Includes the employee's display name — the dashboard's "upcoming changes" list needs
      // something more useful than a raw employeeId; this is a display concern, not new business
      // logic (the precedence/eligibility rules are untouched).
      with: {
        workSchedule: true,
        shift: true,
        employee: { columns: { id: true, firstName: true, lastName: true, employeeNumber: true } },
      },
    });
  },
  create(tx: DbExecutor, companyId: string, employeeId: string, input: Record<string, unknown>) {
    return tx
      .insert(employeeScheduleAssignments)
      .values({ companyId, employeeId, ...input } as typeof employeeScheduleAssignments.$inferInsert)
      .returning()
      .then((rows) => rows[0]!);
  },
  closeAssignment(tx: DbExecutor, id: string, effectiveTo: string) {
    return tx
      .update(employeeScheduleAssignments)
      .set({ effectiveTo })
      .where(eq(employeeScheduleAssignments.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
  update(id: string, input: { effectiveTo?: string | null; note?: string }) {
    return db
      .update(employeeScheduleAssignments)
      .set(input)
      .where(eq(employeeScheduleAssignments.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
};

export const weeklyOffRuleRepository = {
  findById(id: string) {
    return db.query.weeklyOffRules.findFirst({ where: eq(weeklyOffRules.id, id) });
  },
  findCompanyDefault(companyId: string) {
    return db.query.weeklyOffRules.findFirst({
      where: and(eq(weeklyOffRules.companyId, companyId), isNull(weeklyOffRules.employeeId), eq(weeklyOffRules.isActive, true)),
    });
  },
  /** The employee's currently open-ended override, regardless of date — at most one can exist. */
  findOpenOverrideForEmployee(employeeId: string, executor: DbExecutor = db) {
    return executor.query.weeklyOffRules.findFirst({
      where: and(eq(weeklyOffRules.employeeId, employeeId), isNull(weeklyOffRules.effectiveTo)),
    });
  },
  /** The employee's active override covering `date`, if any. */
  findActiveOverrideForEmployee(employeeId: string, date: string) {
    return db.query.weeklyOffRules.findFirst({
      where: and(
        eq(weeklyOffRules.employeeId, employeeId),
        eq(weeklyOffRules.isActive, true),
        or(isNull(weeklyOffRules.effectiveFrom), lte(weeklyOffRules.effectiveFrom, date)),
        or(isNull(weeklyOffRules.effectiveTo), gte(weeklyOffRules.effectiveTo, date)),
      ),
    });
  },
  create(input: typeof weeklyOffRules.$inferInsert, executor: DbExecutor = db) {
    return executor
      .insert(weeklyOffRules)
      .values(input)
      .returning()
      .then((rows) => rows[0]!);
  },
  deactivate(id: string, executor: DbExecutor = db) {
    return executor
      .update(weeklyOffRules)
      .set({ isActive: false })
      .where(eq(weeklyOffRules.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
  closeEmployeeOverride(employeeId: string, effectiveTo: string, executor: DbExecutor = db) {
    return executor
      .update(weeklyOffRules)
      .set({ effectiveTo })
      .where(and(eq(weeklyOffRules.employeeId, employeeId), isNull(weeklyOffRules.effectiveTo)))
      .returning();
  },
};

export const holidayRepository = {
  findById(id: string) {
    return db.query.holidays.findFirst({ where: eq(holidays.id, id) });
  },
  listByCompanyInRange(companyId: string, from: string, to: string) {
    return db.query.holidays.findMany({
      where: and(eq(holidays.companyId, companyId), gte(holidays.date, from), lte(holidays.date, to)),
      orderBy: asc(holidays.date),
    });
  },
  /** Active holiday for this exact date — company-wide or scoped to `branchId`. */
  findActiveForDate(companyId: string, branchId: string | null, date: string) {
    return db.query.holidays.findFirst({
      where: and(
        eq(holidays.companyId, companyId),
        eq(holidays.date, date),
        eq(holidays.isActive, true),
        branchId ? or(isNull(holidays.branchId), eq(holidays.branchId, branchId)) : isNull(holidays.branchId),
      ),
    });
  },
  create(companyId: string, input: CreateHolidayInput & { createdByUserId: string }) {
    return db
      .insert(holidays)
      .values({ companyId, ...input })
      .returning()
      .then((rows) => rows[0]!);
  },
  update(id: string, input: UpdateHolidayInput) {
    return db
      .update(holidays)
      .set(input)
      .where(eq(holidays.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
  setActive(id: string, isActive: boolean) {
    return db
      .update(holidays)
      .set({ isActive })
      .where(eq(holidays.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
};

export const workforceEmployeeRepository = {
  listActiveIds(companyId: string): Promise<{ id: string; branchId: string | null }[]> {
    return db
      .select({ id: employees.id, branchId: employees.locationId })
      .from(employees)
      .where(and(eq(employees.companyId, companyId), eq(employees.isArchived, false), eq(employees.employmentStatus, "ACTIVE")));
  },
};
