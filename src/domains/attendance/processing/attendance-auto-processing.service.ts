/**
 * Batch 13 — scheduled "materialize missing daily records".
 *
 * This is an orchestration layer around the existing domain logic, NOT a second calculation
 * engine: every record is produced by `materializeMissingDailyRecord` (attendance/service.ts),
 * which runs the one `calculateDailyAttendance` engine.
 *
 * INVARIANTS
 *  - An employee who already has a daily record for the date is skipped: never recalculated, never
 *    re-evaluated against the current policy, never modified. The only write is an
 *    `INSERT ... ON CONFLICT DO NOTHING`.
 *  - Idempotent: a second run over the same company/date finds nothing missing and writes nothing.
 *  - One PostgreSQL advisory lock per (company, work date) serializes runs across processes and
 *    instances; the (employee, work date) unique index remains the final duplicate guard.
 *  - One employee failing never aborts the run; each employee is its own transaction.
 *  - Closed periods are never written to. Archived and not-yet-joined employees are excluded, and
 *    employment status is judged as recorded at the END of the work date (not today's status), so
 *    a since-reinstated employee is not given false absences for days they were suspended.
 *  - No check-out is ever fabricated and no OPEN session is ever closed.
 *  - The caller controls nothing about tenancy: companies come from the database, and the system
 *    actor is an explicit company-scoped audit context with no user, not a fake administrator.
 */
import { env } from "@/config/env";
import type { RequestContext } from "@/lib/auth/request-context";
import { requirePermission } from "@/lib/auth/request-context";
import { logger } from "@/lib/logger";
import { recordAuditLog, type SystemAuditContext } from "@/domains/audit/service";
import { addDays, zonedWallTimeToUtc } from "@/lib/datetime";
import { AttendancePeriodLockedError } from "../errors";
import { isAttendancePeriodClosed } from "../periods/attendance-period.service";
import { materializeMissingDailyRecord, type MaterializeMissingResult } from "../service";
import { computeDueWorkDates } from "./due-dates";
import {
  attendanceProcessingRepository,
  type AttendanceProcessingRun,
  type ProcessingTrigger,
} from "./attendance-processing.repository";

const MAX_MESSAGE_LENGTH = 1000;
const MAX_LOGGED_FAILURES = 5;

export type WorkDateOutcome = "PROCESSED" | "UP_TO_DATE" | "SKIPPED_PERIOD_CLOSED" | "SKIPPED_LOCKED" | "FAILED";

export type WorkDateResult = {
  workDate: string;
  outcome: WorkDateOutcome;
  created: number;
  skipped: number;
  failed: number;
  runId: string | null;
};

export type CompanyProcessingResult = { companyId: string; dates: WorkDateResult[]; error: string | null };

export type ScheduledProcessingSummary = {
  companiesProcessed: number;
  companiesFailed: number;
  created: number;
  skipped: number;
  failed: number;
  companies: CompanyProcessingResult[];
};

export type ScheduledProcessingOptions = {
  /** Defaults to the current time; a parameter so date selection is testable. */
  now?: Date;
  lagMinutes?: number;
  lookbackDays?: number;
  trigger?: ProcessingTrigger;
  /** Server-side restriction of which companies to cover. NEVER wire this to request input — the
   *  public job endpoint always processes every active company. Used by tests and operators. */
  companyIds?: string[];
};

/** Test seam: the per-employee write. Production always uses `materializeMissingDailyRecord`. */
export type ProcessingDeps = {
  materialize: (companyId: string, employeeId: string, workDate: string) => Promise<MaterializeMissingResult>;
};

const defaultDeps: ProcessingDeps = { materialize: materializeMissingDailyRecord };

function truncate(message: string): string {
  return message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : message;
}

function systemContext(companyId: string): SystemAuditContext {
  return { companyId, requestId: crypto.randomUUID(), userId: null };
}

/** Processes one (company, work date): the full materialize-missing algorithm. */
export async function processCompanyWorkDate(
  companyId: string,
  workDate: string,
  trigger: ProcessingTrigger,
  deps: ProcessingDeps = defaultDeps,
): Promise<WorkDateResult> {
  const result = (outcome: WorkDateOutcome, counts?: Partial<Pick<WorkDateResult, "created" | "skipped" | "failed" | "runId">>): WorkDateResult => ({
    workDate,
    outcome,
    created: counts?.created ?? 0,
    skipped: counts?.skipped ?? 0,
    failed: counts?.failed ?? 0,
    runId: counts?.runId ?? null,
  });

  // Fast, non-locking rejection; the authoritative check is inside each employee's transaction.
  if (await isAttendancePeriodClosed(companyId, workDate.slice(0, 7))) return result("SKIPPED_PERIOD_CLOSED");

  const locked = await attendanceProcessingRepository.withProcessingLock(companyId, workDate, async (): Promise<WorkDateResult> => {
    // Two queries for the whole company/date: eligible employees, and who already has a record.
    // Eligibility is judged by the status recorded as of the END of the work date, not today's
    // status (see listEligibleEmployeeIdsAsOf) — the job re-examines recent dates every run.
    const companyTimezone = await attendanceProcessingRepository.getCompanyTimezone(companyId);
    const endOfWorkDate = zonedWallTimeToUtc(addDays(workDate, 1), "00:00:00", companyTimezone);
    const [eligibleIds, alreadyRecorded] = await Promise.all([
      attendanceProcessingRepository.listEligibleEmployeeIdsAsOf(companyId, workDate, endOfWorkDate),
      attendanceProcessingRepository.listEmployeeIdsWithRecord(companyId, workDate),
    ]);
    const eligible = eligibleIds.map((id) => ({ id }));
    const missing = eligible.filter((employee) => !alreadyRecorded.has(employee.id));
    if (missing.length === 0) return result("UP_TO_DATE");

    await attendanceProcessingRepository.abandonStaleRunning(companyId, workDate);
    const run: AttendanceProcessingRun = await attendanceProcessingRepository.insertRunning(companyId, workDate, trigger);

    let created = 0;
    let skipped = eligible.length - missing.length;
    let failed = 0;
    const failureMessages: string[] = [];

    try {
      for (const employee of missing) {
        try {
          const outcome = await deps.materialize(companyId, employee.id, workDate);
          if (outcome === "CREATED") created += 1;
          else skipped += 1;
        } catch (error) {
          if (error instanceof AttendancePeriodLockedError) {
            // The period was closed while this run was in flight: nothing was written for this employee.
            skipped += 1;
            continue;
          }
          failed += 1;
          logger.error({ err: error, companyId, employeeId: employee.id, workDate }, "Scheduled attendance processing failed for one employee");
          if (failureMessages.length < MAX_LOGGED_FAILURES) {
            failureMessages.push(`${employee.id}: ${error instanceof Error ? error.message : "unknown error"}`);
          }
        }
      }

      const finished = await attendanceProcessingRepository.finish(run.id, companyId, {
        status: "COMPLETED",
        createdCount: created,
        skippedCount: skipped,
        failedCount: failed,
        message: failureMessages.length > 0 ? truncate(failureMessages.join("; ")) : null,
      });
      await auditRun(companyId, trigger, finished);
      return result("PROCESSED", { created, skipped, failed, runId: run.id });
    } catch (error) {
      // Something outside the per-employee isolation failed (e.g. the database went away).
      const finished = await attendanceProcessingRepository
        .finish(run.id, companyId, {
          status: "FAILED",
          createdCount: created,
          skippedCount: skipped,
          failedCount: failed,
          message: truncate(error instanceof Error ? error.message : "unknown error"),
        })
        .catch(() => null);
      if (finished) await auditRun(companyId, trigger, finished);
      logger.error({ err: error, companyId, workDate }, "Scheduled attendance processing run failed");
      return result("FAILED", { created, skipped, failed, runId: run.id });
    }
  });

  return locked.acquired ? locked.value : result("SKIPPED_LOCKED");
}

/** One summary audit entry per run (not per employee) — the run-history row holds the detail. */
async function auditRun(companyId: string, trigger: ProcessingTrigger, run: AttendanceProcessingRun): Promise<void> {
  await recordAuditLog(systemContext(companyId), {
    action: trigger === "SCHEDULED" ? "attendance.process.scheduled" : "attendance.process.manual",
    entityType: "attendance_processing_run",
    entityId: run.id,
    newData: {
      status: run.status,
      createdCount: run.createdCount,
      skippedCount: run.skippedCount,
      failedCount: run.failedCount,
      message: run.message,
    },
    metadata: { actor: "system", workDate: run.workDate, trigger },
  });
}

/**
 * Entry point of the scheduled job. Covers every active company (or `options.companyIds`), and for
 * each: selects the due work dates, then processes them oldest first. Companies and dates are
 * processed sequentially so a large tenant cannot exhaust the connection pool.
 */
export async function runScheduledAttendanceProcessing(
  options: ScheduledProcessingOptions = {},
  deps: ProcessingDeps = defaultDeps,
): Promise<ScheduledProcessingSummary> {
  const now = options.now ?? new Date();
  const lagMinutes = options.lagMinutes ?? env.ATTENDANCE_PROCESSING_LAG_MINUTES;
  const lookbackDays = options.lookbackDays ?? env.ATTENDANCE_PROCESSING_LOOKBACK_DAYS;
  const trigger = options.trigger ?? "SCHEDULED";

  const allCompanies = await attendanceProcessingRepository.listActiveCompanies();
  const companies = options.companyIds ? allCompanies.filter((company) => options.companyIds!.includes(company.id)) : allCompanies;

  const summary: ScheduledProcessingSummary = { companiesProcessed: 0, companiesFailed: 0, created: 0, skipped: 0, failed: 0, companies: [] };

  for (const company of companies) {
    const companyResult: CompanyProcessingResult = { companyId: company.id, dates: [], error: null };
    try {
      const inputs = await attendanceProcessingRepository.getCompanyProcessingInputs(company.id, company.timezone);
      const dueDates = computeDueWorkDates({ now, timezones: inputs.timezones, windows: inputs.windows, lagMinutes, lookbackDays });
      for (const workDate of dueDates) {
        const dateResult = await processCompanyWorkDate(company.id, workDate, trigger, deps);
        companyResult.dates.push(dateResult);
        summary.created += dateResult.created;
        summary.skipped += dateResult.skipped;
        summary.failed += dateResult.failed;
      }
      summary.companiesProcessed += 1;
    } catch (error) {
      // One company's failure (e.g. an invalid stored timezone) must not stop the others.
      summary.companiesFailed += 1;
      companyResult.error = truncate(error instanceof Error ? error.message : "unknown error");
      logger.error({ err: error, companyId: company.id }, "Scheduled attendance processing failed for a company");
    }
    summary.companies.push(companyResult);
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Run history (read-only, permission-gated, company-scoped)
// ---------------------------------------------------------------------------

export type AttendanceProcessingRunPage = { items: AttendanceProcessingRun[]; page: number; pageSize: number; total: number };

export const MAX_RUN_HISTORY_PAGE_SIZE = 100;

export async function listAttendanceProcessingRuns(
  ctx: RequestContext,
  input: { page?: number; pageSize?: number } = {},
): Promise<AttendanceProcessingRunPage> {
  requirePermission(ctx, "attendance.process.view");
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(MAX_RUN_HISTORY_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize ?? 20)));
  const [items, total] = await Promise.all([
    attendanceProcessingRepository.listByCompany(ctx.companyId, { page, pageSize }),
    attendanceProcessingRepository.countByCompany(ctx.companyId),
  ]);
  return { items, page, pageSize, total };
}
