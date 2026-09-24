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
