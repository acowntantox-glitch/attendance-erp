import type {
  attendanceCorrections,
  attendanceDailyRecords,
  attendanceDailyStatusEnum,
  attendanceEvents,
  attendanceEventTypeEnum,
  attendanceOpenSessions,
  attendanceSourceEnum,
} from "@/db/schema";
import type { Shift, WorkSchedule } from "@/domains/workforce/model";

export type AttendanceSession = typeof attendanceOpenSessions.$inferSelect;

/** A session with its captured-at-check-in schedule/shift rows attached (via the relations
 *  already defined in schema/relations.ts) — display-only; the calculation engine never reads
 *  these, only the snapshot's own `expectedStartAt`/`expectedEndAt`/`gracePeriodMinutes` fields. */
export type AttendanceSessionWithSchedule = AttendanceSession & {
  expectedWorkSchedule: WorkSchedule | null;
  expectedShift: Shift | null;
};

/**
 * A session enriched with its own gross duration/break minutes — UI display convenience only,
 * computed server-side by reusing `calculation.ts`'s `diffMinutes`/`closedBreakMinutes` (plain
 * arithmetic on this session's own raw timestamps, not a second implementation of the day-level
 * normalization/precedence logic). `sessionWorkedMinutes` is null while the session is still OPEN
 * — never fabricated. These fields are NOT authoritative totals: the day's real `workedMinutes`/
 * `overtimeMinutes`/etc. always come from `AttendanceDailyRecord`, never summed from these.
 */
export type AttendanceSessionView = AttendanceSessionWithSchedule & {
  sessionBreakMinutes: number;
  sessionWorkedMinutes: number | null;
};

export type AttendanceEvent = typeof attendanceEvents.$inferSelect;
export type AttendanceDailyRecord = typeof attendanceDailyRecords.$inferSelect;
export type AttendanceCorrection = typeof attendanceCorrections.$inferSelect;
export type AttendanceEventType = (typeof attendanceEventTypeEnum.enumValues)[number];
export type AttendanceSource = (typeof attendanceSourceEnum.enumValues)[number];
export type AttendanceDailyStatus = (typeof attendanceDailyStatusEnum.enumValues)[number];

export type CheckInInput = {
  idempotencyKey?: string;
  source?: AttendanceSource;
  sourceMetadata?: Record<string, unknown>;
};

export type CheckOutInput = {
  idempotencyKey?: string;
  source?: AttendanceSource;
  sourceMetadata?: Record<string, unknown>;
};

export type BreakInput = {
  idempotencyKey?: string;
  source?: AttendanceSource;
  sourceMetadata?: Record<string, unknown>;
};

export type RequestCorrectionInput = {
  workDate: string;
  fieldChanged: AttendanceCorrectionField;
  /** The specific event being corrected, if any — null/omitted for a missing-punch correction. */
  eventId?: string;
  correctedValue: Date;
  reason: string;
};

export type ReviewCorrectionInput = {
  reviewNote?: string;
};

/** A correction enriched with display names for the HR queue/detail UI and the employee's own
 *  correction list — joins only, never a second calculation of anything. */
export type AttendanceCorrectionWithDetails = AttendanceCorrection & {
  employee: { id: string; firstName: string; lastName: string; employeeNumber: string };
  requestedBy: { id: string; fullName: string } | null;
  reviewedBy: { id: string; fullName: string } | null;
};

/**
 * One resolved, non-overlapping expectation period used by the calculation engine — the output of
 * normalizing a work date's distinct attendance snapshots (see calculation.ts). `expectedStart`
 * never changes from the snapshot's own value; `operativeEnd` is the (possibly truncated) end
 * actually used for scheduled-minutes/early-departure purposes.
 */
export type NormalizedExpectationPeriod = {
  expectedStart: Date;
  expectedEnd: Date;
  operativeEnd: Date;
  gracePeriodMinutes: number;
  /** The check-in instant of the session that first captured this distinct snapshot — used only
   *  as the ordering/truncation anchor, not as a worked-time input. */
  firstCapturedAt: Date;
};

/** One session's contribution to a day's calculation — a thin, DB-independent projection of
 *  `AttendanceSession` + its closed break intervals, so the pure calculation engine never touches
 *  Drizzle types or the database directly. `startEventId`/`endEventId` are optional purely so a
 *  BREAK_START/BREAK_END correction override (see `AttendanceCorrectionOverride`) can identify
 *  which break within the session it targets — `calculateDailyAttendance` itself never reads them. */
export type AttendanceSessionInput = {
  sessionId: string;
  checkInAt: Date;
  checkOutAt: Date | null;
  status: "OPEN" | "CLOSED" | "ABANDONED";
  isHoliday: boolean;
  isWeeklyOff: boolean;
  isWorkingDay: boolean;
  expectedStartAt: Date | null;
  expectedEndAt: Date | null;
  gracePeriodMinutes: number;
  breaks: { startAt: Date; endAt: Date | null; startEventId?: string | null; endEventId?: string | null }[];
};

export type AttendanceCorrectionField = "CHECK_IN" | "CHECK_OUT" | "BREAK_START" | "BREAK_END";

/**
 * A single approved correction, resolved into a form the pure calculation adapter can apply
 * without any database access (see calculation.ts `applyCorrectionsToSessions`). Built by the
 * service layer, which does the (simple, existing-pattern) lookups this requires: resolving
 * `eventId` to the session it belongs to, or determining that no session exists yet and a
 * synthetic one must be created (a missing-check-in correction on an otherwise untouched work
 * date — see service.ts `buildCorrectionOverride`).
 */
export type AttendanceCorrectionOverride = {
  correctionId: string;
  fieldChanged: AttendanceCorrectionField;
  eventId: string | null;
  correctedValue: Date;
  /** The session this override applies to. Null only for a CHECK_IN override with no existing
   *  session at all for that work date — the adapter creates a synthetic session-input for
   *  calculation purposes only, never a real `attendance_open_sessions`/`attendance_events` row. */
  sessionId: string | null;
  /** Present only when `sessionId` is null — the Workforce expectation to snapshot onto the new
   *  synthetic session, resolved fresh via `getWorkforceDayInfo` at approval time (there was never
   *  a real check-in to snapshot from). */
  syntheticSnapshot?: {
    expectedStartAt: Date | null;
    expectedEndAt: Date | null;
    gracePeriodMinutes: number;
    isHoliday: boolean;
    isWeeklyOff: boolean;
    isWorkingDay: boolean;
  };
};

/** The single, fresh, day-level Workforce fact used only for status classification and the
 *  zero-session (ABSENT/NO_SCHEDULE) case — never used to override a session's own frozen
 *  snapshot. Resolved once per calculation via `getWorkforceDayInfo`. */
export type DailyWorkforceContext = {
  isHoliday: boolean;
  isWeeklyOff: boolean;
  isWorkingDay: boolean;
  expectedStartAt: Date | null;
  expectedEndAt: Date | null;
  gracePeriodMinutes: number;
};

export type DailyCalculationResult = {
  status: AttendanceDailyStatus;
  scheduledMinutes: number;
  workedMinutes: number | null;
  breakMinutes: number;
  overtimeMinutes: number | null;
  lateMinutes: number | null;
  earlyDepartureMinutes: number | null;
  firstCheckInAt: Date | null;
  lastCheckOutAt: Date | null;
  sessionCount: number;
};

// ---------------------------------------------------------------------------
// HR/Manager dashboard (Batch 3) — read-only presentation types over
// attendance_daily_records / attendance_open_sessions. Nothing here recomputes a status, a late/
// early/overtime figure, or Workforce precedence — every value is read straight off the
// authoritative rows those tables already hold.
// ---------------------------------------------------------------------------

type EmployeeSummary = {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  department: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
};

/** Per-status counts for one company + work date, plus the total active employee count (which is
 *  independent of whether a daily record has been computed yet — see `employeesWithoutRecord`). */
export type AttendanceDashboardSummary = {
  workDate: string;
  totalEmployees: number;
  statusCounts: Record<AttendanceDailyStatus, number>;
  /** Active employees with no `attendance_daily_records` row for this date at all — nobody
   *  checked in and nobody has viewed/recalculated their day yet. Not a status; see §24/§33 —
   *  Batch 1 never generates ABSENT automatically, so this is the honest "not yet known" bucket,
   *  surfaced for transparency rather than folded into any real status. */
  employeesWithoutRecord: number;
};

/** One row of the paginated dashboard table — the employee plus whatever daily record exists for
 *  the selected date (null fields throughout when no record has been computed yet) plus the
 *  schedule/shift captured by that date's first session, if any. */
export type AttendanceDashboardRow = EmployeeSummary & {
  record: AttendanceDailyRecord | null;
  scheduleName: string | null;
  shiftName: string | null;
  timezone: string | null;
};

export type AttendanceDashboardRowsResult = {
  items: AttendanceDashboardRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type CurrentlyWorkingRow = EmployeeSummary & {
  session: AttendanceSessionView;
  hasOpenBreak: boolean;
};

export type LateArrivalRow = EmployeeSummary & {
  record: AttendanceDailyRecord;
  scheduleName: string | null;
  shiftName: string | null;
  /** From the first session that captured this date's snapshot — needed to display
   *  `record.firstCheckInAt` (a UTC instant) as a correct local time; not itself a calculated value. */
  timezone: string | null;
};

export type IncompleteAttendanceRow = EmployeeSummary & {
  record: AttendanceDailyRecord;
  scheduleName: string | null;
  shiftName: string | null;
  timezone: string | null;
};

export type AttendanceDashboardFilters = {
  workDate: string;
  page: number;
  pageSize: number;
  search?: string;
  departmentId?: string;
  locationId?: string;
  status?: AttendanceDailyStatus;
};

export type AttendanceDashboardResult = {
  summary: AttendanceDashboardSummary;
  currentlyWorking: CurrentlyWorkingRow[];
  lateArrivals: LateArrivalRow[];
  incompleteAttendance: IncompleteAttendanceRow[];
  table: AttendanceDashboardRowsResult;
};
