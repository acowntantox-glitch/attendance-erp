import { sql } from "drizzle-orm";
import { boolean, date, index, integer, pgEnum, pgTable, text, time, uniqueIndex, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { branches, companies } from "./organization";
import { employees } from "./employee";
import { users } from "./auth";

export const holidayTypeEnum = pgEnum("holiday_type", ["PUBLIC", "RELIGIOUS", "COMPANY", "OPTIONAL"]);

/**
 * Governs daily hours only (start/end/break/timezone) — deliberately NOT which days are
 * worked. Day selection lives entirely in `weeklyOffRules` so there is exactly one source of
 * truth for "is this a working day," not two that could disagree. `startTime`/`endTime` are
 * wall-clock values in `timezone` (or the resolved company/branch fallback) — see
 * src/lib/datetime. `endTime` is not required to be after `startTime`; a schedule's default
 * hours can themselves span midnight the same way a Shift can (see `shifts` below).
 */
export const workSchedules = pgTable(
  "work_schedules",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    timezone: text(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    breakDurationMinutes: integer("break_duration_minutes"),
    breakStartTime: time("break_start_time"),
    isBreakPaid: boolean("is_break_paid").notNull().default(false),
    // Schedule-template applicability window (e.g. a seasonal "Ramadan Hours" schedule) —
    // distinct from the per-employee assignment dates on employeeScheduleAssignments below.
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("work_schedules_company_name_unique").on(table.companyId, table.name),
    index("work_schedules_company_id_idx").on(table.companyId),
    index("work_schedules_company_active_idx").on(table.companyId, table.isActive),
  ],
);

/**
 * `endTime <= startTime` means the shift crosses midnight — this is a valid, expected shape
 * (e.g. Night 22:00 -> 06:00), never an error. Whether a given shift crosses midnight is never
 * stored (would risk drifting from startTime/endTime); it's always computed via
 * `shiftSpansMidnight()` in src/lib/datetime, shared by this domain and the future Attendance
 * engine so both agree on the same rule.
 */
export const shifts = pgTable(
  "shifts",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text().notNull(),
    code: text().notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    breakDurationMinutes: integer("break_duration_minutes"),
    breakStartTime: time("break_start_time"),
    isBreakPaid: boolean("is_break_paid").notNull().default(false),
    gracePeriodMinutes: integer("grace_period_minutes").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("shifts_company_code_unique").on(table.companyId, table.code),
    index("shifts_company_id_idx").on(table.companyId),
    index("shifts_company_active_idx").on(table.companyId, table.isActive),
  ],
);

/**
 * The historical, append-mostly record of "who was on what schedule/shift, and from when."
 * Existing rows are never mutated except to shorten `effectiveTo` (early termination) or edit
 * `note` — see domains/workforce/service.ts `updateEmployeeScheduleAssignment`. Changing what
 * schedule/shift applies always means closing the current open row and inserting a new one in
 * the same transaction, never rewriting `employeeId`/`workScheduleId`/`shiftId`/`effectiveFrom`.
 *
 * The partial unique index below guarantees at most one *open-ended* ("current") assignment per
 * employee at the database level. Overlap prevention across closed historical ranges is enforced
 * in the service layer inside a transaction, not a `btree_gist` exclusion constraint — see the
 * Phase 3 architecture proposal for why (avoids a Postgres extension for a case the transactional
 * close-then-insert flow already prevents in the normal path).
 */
export const employeeScheduleAssignments = pgTable(
  "employee_schedule_assignments",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workScheduleId: uuid("work_schedule_id")
      .notNull()
      .references(() => workSchedules.id),
    shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    assignedByUserId: uuid("assigned_by_user_id").references(() => users.id, { onDelete: "set null" }),
    note: text(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("employee_schedule_assignments_open_unique")
      .on(table.employeeId)
      .where(sql`${table.effectiveTo} is null`),
    index("employee_schedule_assignments_employee_from_idx").on(table.employeeId, table.effectiveFrom),
    index("employee_schedule_assignments_company_from_idx").on(table.companyId, table.effectiveFrom),
  ],
);

/**
 * Both the company-wide default and any employee-specific override live here, distinguished by
 * nullable `employeeId` — a null row is the company default, a non-null row is that employee's
 * override. `offDays` uses 0(Sun)-6(Sat), never hard-coded to a specific pair of days.
 */
export const weeklyOffRules = pgTable(
  "weekly_off_rules",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "cascade" }),
    offDays: integer("off_days").array().notNull(),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("weekly_off_rules_company_default_unique")
      .on(table.companyId)
      .where(sql`${table.employeeId} is null and ${table.isActive} = true`),
    uniqueIndex("weekly_off_rules_employee_open_unique")
      .on(table.employeeId)
      .where(sql`${table.employeeId} is not null and ${table.effectiveTo} is null`),
    index("weekly_off_rules_company_id_idx").on(table.companyId),
    index("weekly_off_rules_employee_id_idx").on(table.employeeId),
  ],
);

/**
 * `branchId` null means company-wide; set means scoped to that one branch. The two partial
 * unique indexes below (rather than one plain `unique(companyId, branchId, date)`) are required
 * because Postgres treats NULL <> NULL in unique constraints — a plain unique would silently
 * allow two company-wide holidays on the same date.
 */
export const holidays = pgTable(
  "holidays",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    name: text().notNull(),
    date: date().notNull(),
    holidayType: holidayTypeEnum("holiday_type").notNull(),
    description: text(),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("holidays_company_date_unique").on(table.companyId, table.date).where(sql`${table.branchId} is null`),
    uniqueIndex("holidays_branch_date_unique").on(table.branchId, table.date).where(sql`${table.branchId} is not null`),
    index("holidays_company_date_idx").on(table.companyId, table.date),
    index("holidays_branch_date_idx").on(table.branchId, table.date),
  ],
);
