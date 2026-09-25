import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { companies } from "./organization";
import { employees } from "./employee";
import { users } from "./auth";
import { shifts, workSchedules } from "./workforce";

export const attendanceEventTypeEnum = pgEnum("attendance_event_type", ["CHECK_IN", "CHECK_OUT", "BREAK_START", "BREAK_END"]);

/** Only MANUAL (self-service or HR-entered) is used by Batch 1. GPS/GPS_FACE/QR/BIOMETRIC are
 *  reserved for later phases (docs/architecture/attendance-architecture.md) — adding a value is a
 *  simple `ALTER TYPE ... ADD VALUE` migration, not a redesign. */
export const attendanceSourceEnum = pgEnum("attendance_source", ["MANUAL"]);

export const attendanceSessionStatusEnum = pgEnum("attendance_session_status", ["OPEN", "CLOSED", "ABANDONED"]);

export const attendanceDailyStatusEnum = pgEnum("attendance_daily_status", [
  "PRESENT",
  "LATE",
  "ABSENT",
  "INCOMPLETE",
  "WEEKLY_OFF",
  "HOLIDAY",
  "WEEKLY_OFF_WORKED",
  "HOLIDAY_WORKED",
  "NO_SCHEDULE",
]);

export const attendanceCorrectionStatusEnum = pgEnum("attendance_correction_status", ["PENDING", "APPROVED", "REJECTED"]);

/** Deliberately just OPEN/CLOSED (Batch 8) — no FINALIZED/APPROVED/LOCKED/REOPENED. A "reopened"
 *  period is simply OPEN again; its history (who closed it, who reopened it, when) lives in the
 *  existing audit log, not in extra statuses here. */
export const attendancePeriodStatusEnum = pgEnum("attendance_period_status", ["OPEN", "CLOSED"]);

/** Batch 10 — which detected exception a dismissal applies to. Deliberately its own enum, not
 *  `attendance_daily_status`: `EARLY_DEPARTURE` is not a daily status at all (it's a minute
 *  threshold on an otherwise PRESENT/LATE record), so the two enums are not interchangeable. */
export const attendanceExceptionTypeEnum = pgEnum("attendance_exception_type", ["LATE", "INCOMPLETE", "ABSENT", "EARLY_DEPARTURE"]);

/** Reuses the same four event types corrections can target — no second attendance
 *  representation (see Batch 4 architecture: a correction proposes a value for one of these). */
export const attendanceCorrectionFieldEnum = pgEnum("attendance_correction_field", [
  "CHECK_IN",
  "CHECK_OUT",
  "BREAK_START",
  "BREAK_END",
]);

/**
 * One row per check-in-to-checkout session (despite the "open" in the name — kept for continuity
 * with the approved architecture's naming — this is the durable per-session ledger, not an
 * ephemeral single-row-while-open table). `status` transitions forward only: OPEN -> CLOSED (a
 * real CHECK_OUT happened) or OPEN -> ABANDONED (a later CHECK_IN superseded it without ever
 * seeing a CHECK_OUT — see domains/attendance/service.ts `checkIn`). Once CLOSED/ABANDONED, a
 * row's snapshot columns never change again; only `status`/`checkOutAt` are ever written after
 * creation, so despite living in a "mutable" table this is effectively append-once per row.
 *
 * The Workforce expectation snapshot (expectedStartAt/expectedEndAt/etc.) is captured exactly
 * once, at CHECK_IN, from `getWorkforceDayInfo` — never re-resolved at CHECK_OUT or later, per the
 * approved Phase 4 calculation amendment. `expectedStartAt`/`expectedEndAt` are real UTC instants
 * (already resolved through the wall-clock -> UTC conversion), not wall-clock date/time pairs —
 * the calculation engine only ever needs to compare them against other UTC instants.
 */
export const attendanceOpenSessions = pgTable(
  "attendance_open_sessions",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    status: attendanceSessionStatusEnum().notNull().default("OPEN"),
    checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull(),
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
    expectedWorkScheduleId: uuid("expected_work_schedule_id").references(() => workSchedules.id, { onDelete: "set null" }),
    expectedShiftId: uuid("expected_shift_id").references(() => shifts.id, { onDelete: "set null" }),
    expectedStartAt: timestamp("expected_start_at", { withTimezone: true }),
    expectedEndAt: timestamp("expected_end_at", { withTimezone: true }),
    resolvedTimezone: text("resolved_timezone"),
    gracePeriodMinutes: integer("grace_period_minutes").notNull().default(0),
    isHoliday: boolean("is_holiday").notNull().default(false),
    isWeeklyOff: boolean("is_weekly_off").notNull().default(false),
    isWorkingDay: boolean("is_working_day").notNull().default(true),
    source: attendanceSourceEnum().notNull().default("MANUAL"),
    ...timestamps,
  },
  (table) => [
    // At most one OPEN session per employee — the DB-level guarantee behind "no two open
    // sessions," relied on directly (concurrent check-ins race on this constraint, not on
    // application-level locking alone — see checkIn()).
    uniqueIndex("attendance_open_sessions_employee_open_unique").on(table.employeeId).where(sql`${table.status} = 'OPEN'`),
    index("attendance_open_sessions_employee_checkin_idx").on(table.employeeId, table.checkInAt),
    index("attendance_open_sessions_company_workdate_idx").on(table.companyId, table.workDate),
    index("attendance_open_sessions_employee_workdate_idx").on(table.employeeId, table.workDate),
  ],
);

/**
 * Append-only. Never updated or deleted by normal application code (no `updatedAt` column,
 * deliberately, to make that immutability evident in the schema itself). Every mutation of
 * attendance state happens by inserting a new event, never by editing one — see ADR-0003.
 */
export const attendanceEvents = pgTable(
  "attendance_events",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => attendanceOpenSessions.id, { onDelete: "cascade" }),
    // Denormalized from the session for efficient day-scoped queries without a join.
    workDate: date("work_date").notNull(),
    eventType: attendanceEventTypeEnum("event_type").notNull(),
    // Server-authoritative capture instant (ADR-0007) — never client-supplied.
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    source: attendanceSourceEnum().notNull().default("MANUAL"),
    sourceMetadata: jsonb("source_metadata"),
    // Client-generated UUID; a retry with the same key returns the original result instead of
    // erroring or creating a duplicate event (ADR-0009).
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("attendance_events_idempotency_unique")
      .on(table.employeeId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index("attendance_events_session_id_idx").on(table.sessionId),
    index("attendance_events_company_employee_workdate_idx").on(table.companyId, table.employeeId, table.workDate),
    index("attendance_events_employee_occurred_idx").on(table.employeeId, table.occurredAt),
  ],
);

/**
 * The derived, recalculable-at-any-time daily projection (ADR-0003) — never the source of truth,
 * always rebuildable from `attendanceOpenSessions` + `attendanceEvents` (+ approved corrections)
 * via `recalculateDailyRecord`. `workedMinutes`/`overtimeMinutes`/`lateMinutes`/
 * `earlyDepartureMinutes` are nullable: null means "not yet knowable" (e.g. the day contains a
 * session with no checkout), never a silently-fabricated zero.
 */
export const attendanceDailyRecords = pgTable(
  "attendance_daily_records",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    status: attendanceDailyStatusEnum().notNull(),
    scheduledMinutes: integer("scheduled_minutes").notNull().default(0),
    workedMinutes: integer("worked_minutes"),
    breakMinutes: integer("break_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes"),
    lateMinutes: integer("late_minutes"),
    earlyDepartureMinutes: integer("early_departure_minutes"),
    firstCheckInAt: timestamp("first_check_in_at", { withTimezone: true }),
    lastCheckOutAt: timestamp("last_check_out_at", { withTimezone: true }),
    sessionCount: integer("session_count").notNull().default(0),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("attendance_daily_records_employee_workdate_unique").on(table.employeeId, table.workDate),
    index("attendance_daily_records_company_workdate_idx").on(table.companyId, table.workDate),
  ],
);

/**
 * Immutable correction request/history records — never overwrites an original event, never itself
 * mutated except the status/reviewer/reviewedAt/reviewNote transition on approval or rejection
 * (see domains/attendance/service.ts). An approved correction is read as an override input by the
 * calculation engine (see calculation.ts `applyCorrectionsToSessions`) — it never becomes a
 * synthetic `attendance_events` row.
 *
 * `eventId` is set when the correction retargets a specific existing event's timestamp (e.g. "my
 * check-in was actually 09:00, not 09:25"); it is null for a missing-punch correction (e.g. "I
 * forgot to check out"), where there is no existing event to point at. `originalValue` is a
 * snapshot of what the record showed at request time (null for a missing punch) — captured for
 * display/audit, never re-derived later so the correction's own history stays stable even if
 * something else about the day changes before it's reviewed.
 */
export const attendanceCorrections = pgTable(
  "attendance_corrections",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    eventId: uuid("event_id").references(() => attendanceEvents.id, { onDelete: "set null" }),
    fieldChanged: attendanceCorrectionFieldEnum("field_changed").notNull(),
    originalValue: timestamp("original_value", { withTimezone: true }),
    correctedValue: timestamp("corrected_value", { withTimezone: true }).notNull(),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reason: text().notNull(),
    status: attendanceCorrectionStatusEnum().notNull().default("PENDING"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    ...timestamps,
  },
  (table) => [
    index("attendance_corrections_company_employee_workdate_idx").on(table.companyId, table.employeeId, table.workDate),
    index("attendance_corrections_company_status_idx").on(table.companyId, table.status),
    // Backs the conflict check (no two PENDING/APPROVED corrections targeting the same logical
    // field for the same employee/work date) without a full table scan.
    index("attendance_corrections_conflict_idx").on(table.employeeId, table.workDate, table.fieldChanged),
  ],
);

/**
 * Batch 8 — attendance period closing/locking. One row per (company, calendar month) that has
 * ever been touched by a close/reopen action OR by the lazy "ensure a row exists" step every
 * period-lock check performs (see `attendance-period.repository.ts`'s `ensure`) — a month with no
 * row at all is implicitly OPEN (never closed), exactly like an employee/work-date with no
 * `attendance_daily_records` row is implicitly "not yet processed," not "absent." `periodMonth` is
 * a plain `YYYY-MM` string, matching the exact convention Batch 7's monthly calendar already
 * established for "month" as a concept — not a `date` column, which would force picking an
 * arbitrary day-of-month with no real meaning.
 *
 * `closedAt`/`closedByUserId` describe the CURRENT close (null when the period is OPEN, including
 * after a reopen) — the full close/reopen history lives in the existing audit log
 * (`attendance.period.close`/`.reopen`), not duplicated here.
 */
export const attendancePeriods = pgTable(
  "attendance_periods",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    periodMonth: text("period_month").notNull(),
    status: attendancePeriodStatusEnum().notNull().default("OPEN"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByUserId: uuid("closed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    // §7 — a period must be unique per company at the database level, not just app-checked; this
    // is also the row the `SELECT ... FOR [UPDATE|SHARE]` concurrency strategy locks against (see
    // the period service) — a mutation and a concurrent close on the very same period always
    // contend for this same row.
    uniqueIndex("attendance_periods_company_month_unique").on(table.companyId, table.periodMonth),
  ],
);

/**
 * Batch 10 — attendance exception management. Stores ONLY HR triage metadata: who dismissed a
 * detected exception, when, and why — never any attendance fact. The exception itself (an
 * employee/work-date being LATE/INCOMPLETE/ABSENT, or having a nonzero `earlyDepartureMinutes`)
 * is never persisted; it is always re-derived live from `attendance_daily_records` (see
 * `attendance-exception.repository.ts`). This table's only job is to answer "has a person already
 * looked at and dismissed this specific (employee, date, exception type) combination" — deleting
 * a row (`undismiss`) fully reverses it, with no separate status column, because there is no
 * intermediate state: either a dismissal row exists or it doesn't.
 */
export const attendanceExceptionDismissals = pgTable(
  "attendance_exception_dismissals",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workDate: text("work_date").notNull(),
    exceptionType: attendanceExceptionTypeEnum("exception_type").notNull(),
    dismissedByUserId: uuid("dismissed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "set null" }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
    note: text(),
    ...timestamps,
  },
  (table) => [
    // The row this table's core idempotency guarantee (dismiss is dismiss, however many times)
    // and its own most common lookup (`findOne` for one employee/date/type) both rely on.
    uniqueIndex("attendance_exception_dismissals_employee_workdate_type_unique").on(
      table.employeeId,
      table.workDate,
      table.exceptionType,
    ),
    // The exception queue's own batched per-page lookup filters by companyId + a bounded list of
    // (employeeId, workDate) pairs for the current page — this composite index is what that scan
    // uses; the unique index above already covers employeeId+workDate as a prefix, but a
    // companyId-scoped one avoids ever having to fall back to a full-table scan within a company.
    index("attendance_exception_dismissals_company_workdate_idx").on(table.companyId, table.workDate),
  ],
);
