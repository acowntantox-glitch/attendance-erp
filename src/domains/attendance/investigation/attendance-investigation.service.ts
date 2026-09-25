/**
 * Batch 9 — HR attendance investigation. A pure composition layer: every field below comes
 * straight from an existing, already-authoritative function or repository query. This module
 * never calls `calculateDailyAttendance`, never computes a status/minute figure itself, and never
 * writes anything — it is a read aggregation, not a second attendance engine.
 *
 * `getAttendanceDay` is called first and is the single authorization/self-scope/tenant-isolation
 * checkpoint for this whole aggregate: its resolved `record.employeeId` (never the raw,
 * caller-supplied `requestedEmployeeId`) is what every other query below is keyed on, so an
 * EMPLOYEE caller can never reach another employee's events/corrections/workforce data even
 * though `attendanceEventRepository.listForEmployeeWorkDate`/`attendanceCorrectionRepository
 * .listForEmployeeWorkDate` themselves have no self-scope logic of their own (matching every
 * other raw repository method in this domain — the service layer is what enforces access, not
 * the repository).
 */
import type { RequestContext } from "@/lib/auth/request-context";
import { getWorkforceDayInfo } from "@/domains/workforce/service";
import type { WorkforceDayInfo } from "@/domains/workforce/model";
import { getAttendanceDay } from "../service";
import { attendanceCorrectionRepository, attendanceEventRepository } from "../repository";
import { isAttendancePeriodClosed } from "../periods/attendance-period.service";
import type { AttendanceCorrectionWithDetails, AttendanceDayRecord, AttendanceEvent, AttendanceSessionView } from "../model";

export type AttendanceInvestigation = {
  workDate: string;
  /** Whether `workDate`'s calendar month is closed (Batch 8) — a plain read via
   *  `isAttendancePeriodClosed`, never the permission-gated `getAttendancePeriod` (this screen is
   *  gated on `attendance.view`, not on holding `attendance.period.lock`/`.unlock`). */
  periodClosed: boolean;
  /** What schedule/holiday/weekly-off expectation applied — unchanged `WorkforceDayInfo`, reused
   *  as-is from the Workforce domain, not re-derived. */
  workforceExpectation: WorkforceDayInfo;
  /** The daily result — a real persisted record, or the synthetic non-persisted `"UNPROCESSED"`
   *  stand-in for a closed period with no record yet (Batch 8 follow-up). Never recalculated or
   *  persisted by this function. */
  record: AttendanceDayRecord;
  sessions: AttendanceSessionView[];
  /** The immutable event stream for this work date, chronological — `attendance_events` rows
   *  exactly as stored, never reinterpreted into a second calculation. */
  events: AttendanceEvent[];
  /** Every correction for this work date, any status (PENDING/APPROVED/REJECTED) — distinct from
   *  the APPROVED-only list the calculation engine itself consumes. */
  corrections: AttendanceCorrectionWithDetails[];
};

export async function getAttendanceInvestigation(
  ctx: RequestContext,
  requestedEmployeeId: string,
  workDate: string,
): Promise<AttendanceInvestigation> {
  const { record, sessions } = await getAttendanceDay(ctx, requestedEmployeeId, workDate);
  const employeeId = record.employeeId;

  const [periodClosed, workforceExpectation, events, corrections] = await Promise.all([
    isAttendancePeriodClosed(ctx.companyId, workDate.slice(0, 7)),
    getWorkforceDayInfo(ctx, employeeId, workDate),
    attendanceEventRepository.listForEmployeeWorkDate(employeeId, workDate),
    attendanceCorrectionRepository.listForEmployeeWorkDate(employeeId, workDate),
  ]);

  return { workDate, periodClosed, workforceExpectation, record, sessions, events, corrections };
}
