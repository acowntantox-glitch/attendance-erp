/**
 * Batch 5 — Daily Attendance Processing & Absence Materialization.
 *
 * This module is a thin orchestration layer, not a second calculation engine. It never computes
 * worked/scheduled/late/overtime minutes and never decides HOLIDAY vs WEEKLY_OFF vs ABSENT vs
 * NO_SCHEDULE itself — `calculateDailyAttendance` (via the existing `recalculateDailyRecord` ->
 * `recalculateDailyRecordInternal` path) already implements exactly the decision order this
 * batch's spec describes:
 *
 *   isHoliday?        -> HOLIDAY / HOLIDAY_WORKED
 *   isWeeklyOff?       -> WEEKLY_OFF / WEEKLY_OFF_WORKED
 *   zero sessions?     -> ABSENT (real expected window) or NO_SCHEDULE (no assignment)
 *   sessions but no
 *     expectation
 *     period?          -> NO_SCHEDULE
 *   unclosed session?  -> INCOMPLETE
 *   late?              -> LATE
 *   else               -> PRESENT
 *
 * (see `determineStatus` in `../calculation.ts`, unchanged by this batch). Approved corrections
 * already flow through `applyCorrectionsToSessions` inside that same path (Batch 4) — a missing
 * check-in/check-out approved correction is what makes Rule D's "no applicable approved
 * correction that creates a missing punch" carve-out automatic: if one exists, the synthesized
 * session makes `sessionCount > 0`, so the day is never materialized ABSENT.
 *
 * What this module actually adds: (1) who is *eligible* to be processed for a given company/date
 * (archived/inactive/not-yet-joined employees are skipped — a new, Attendance-processing-specific
 * concern, not a recalculation concern), and (2) bulk orchestration with per-employee failure
 * isolation and aggregate statistics.
 */
import { logger } from "@/lib/logger";
import type { RequestContext } from "@/lib/auth/request-context";
import { assertCompanyAccess, requirePermission } from "@/lib/auth/request-context";
import { recordAuditLog } from "@/domains/audit/service";
import { employeeRepository } from "@/domains/employee/repository";
import { EmployeeNotFoundError } from "@/domains/employee/errors";
import { attendanceDailyStatusEnum } from "@/db/schema";
import { recalculateDailyRecord } from "../service";
import { attendanceDailyRecordRepository } from "../repository";
import { EmployeeNotEligibleForProcessingError } from "../errors";
import type { AttendanceDailyRecord, AttendanceDailyStatus } from "../model";

const ALL_DAILY_STATUSES = attendanceDailyStatusEnum.enumValues;

export type ProcessEmployeeDayResult = {
  employeeId: string;
  workDate: string;
  status: AttendanceDailyStatus;
  created: boolean;
  record: AttendanceDailyRecord;
};

async function assertEligible(ctx: RequestContext, employeeId: string, workDate: string) {
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, employee.companyId);
  if (employee.isArchived || employee.employmentStatus !== "ACTIVE" || employee.dateOfJoining > workDate) {
    throw new EmployeeNotEligibleForProcessingError();
  }
  return employee;
}

/**
 * Operation 1 — process one employee's one day. `companyId` is deliberately NOT a caller-supplied
 * parameter (unlike the batch spec's illustrative pseudocode) — per ADR-0008 and every other
 * Attendance service function, tenant scope is derived solely from `ctx.companyId`, never trusted
 * from client/caller input. `employeeId` is still verified against `ctx.companyId` via
 * `assertCompanyAccess` before anything is read or written.
 *
 * Never creates an `attendance_events`/`attendance_open_sessions` row. The one write this
 * performs — `attendanceDailyRecordRepository.upsert`'s `INSERT ... ON CONFLICT DO UPDATE` on the
 * existing `attendance_daily_records_employee_workdate_unique` index — is already atomic at the
 * database level, so no additional transaction wrapper is needed here: there is nothing else to
 * coordinate in the same write. This is also what makes concurrent processing of the same
 * employee/date safe (two concurrent callers race on one upsert statement, not on a
 * read-then-write check in JavaScript).
 */
export async function processEmployeeAttendanceDay(
  ctx: RequestContext,
  input: { employeeId: string; workDate: string },
): Promise<ProcessEmployeeDayResult> {
  requirePermission(ctx, "attendance.recalculate");
  await assertEligible(ctx, input.employeeId, input.workDate);

  // Read-before-write purely to report `created` vs `updated` in the result — informational
  // only. Under a genuine concurrent race both callers may observe "no record yet" and both
  // report `created: true`; the persisted row itself is still exactly one, by construction of the
  // upsert's unique-index conflict target. Not worth complicating the shared upsert primitive
  // (e.g. an `xmax`-based insert/update flag) just to make this secondary stat race-perfect.
  const existingBefore = await attendanceDailyRecordRepository.findOne(input.employeeId, input.workDate);
  const record = await recalculateDailyRecord(ctx, input.employeeId, input.workDate);

  return { employeeId: input.employeeId, workDate: input.workDate, status: record.status, created: !existingBefore, record };
}

export type ProcessCompanyDayResult = {
  workDate: string;
  totalEmployees: number;
  processed: number;
  created: number;
  updated: number;
  failed: number;
  statusCounts: Record<AttendanceDailyStatus, number>;
};

/**
 * Operation 2 — process every eligible employee in the caller's own company for one day.
 * Sequential, not `Promise.all` — this is a write path (not the read-only pattern
 * `getWorkforceDashboardSummary` uses), and a large company should not open dozens of concurrent
 * connections against a pool sized for interactive request traffic (`max: 10`, see
 * `src/db/client.ts`) all at once. Each employee's failure is caught and counted, never allowed to
 * abort the loop — exactly the "one employee's failure must not roll back an unrelated employee"
 * requirement, which sequential per-employee try/catch (with no shared transaction) gives for
 * free.
 */
export async function processCompanyAttendanceDay(ctx: RequestContext, input: { workDate: string }): Promise<ProcessCompanyDayResult> {
  requirePermission(ctx, "attendance.recalculate");

  const eligible = await employeeRepository.listEligibleForProcessing(ctx.companyId, input.workDate);

  const statusCounts = Object.fromEntries(ALL_DAILY_STATUSES.map((status) => [status, 0])) as Record<AttendanceDailyStatus, number>;
  const stats: ProcessCompanyDayResult = {
    workDate: input.workDate,
    totalEmployees: eligible.length,
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    statusCounts,
  };

  for (const employee of eligible) {
    try {
      const existingBefore = await attendanceDailyRecordRepository.findOne(employee.id, input.workDate);
      const record = await recalculateDailyRecord(ctx, employee.id, input.workDate);
      stats.processed += 1;
      if (existingBefore) stats.updated += 1;
      else stats.created += 1;
      statusCounts[record.status] += 1;
    } catch (error) {
      stats.failed += 1;
      logger.error({ err: error, employeeId: employee.id, workDate: input.workDate }, "Attendance day processing failed for one employee");
    }
  }

  // One summary entry for the bulk operation — distinct from the per-employee "attendance.
  // recalculate" entries `recalculateDailyRecord` already writes for each successfully processed
  // employee. No `entityId`: this describes a company-wide run, not one row.
  await recordAuditLog(ctx, {
    action: "attendance.process",
    entityType: "attendance_processing",
    newData: stats,
    metadata: { workDate: input.workDate },
  });

  return stats;
}
