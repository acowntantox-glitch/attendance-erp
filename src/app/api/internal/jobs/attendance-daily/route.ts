import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { assertInternalJobRequest } from "@/lib/auth/internal-job";
import { runScheduledAttendanceProcessing } from "@/domains/attendance/processing/attendance-auto-processing.service";

// Never cached or statically evaluated: every call must run the job.
export const dynamic = "force-dynamic";

/**
 * Function execution limit, in seconds. Must be a literal for Next.js/Vercel to read it. 60 is
 * allowed on every Vercel plan and configuration (Hobby included), and is ample: the job is
 * materialize-missing-only, so a run that does not finish is simply continued by the next one.
 * Keep `TIME_BUDGET_MS` in step with this value.
 */
export const maxDuration = 60;

/**
 * How long the job may keep STARTING new work: `maxDuration` minus a 15 s safety margin for the
 * employee already in flight, the run bookkeeping and the response. When the budget is spent the
 * job stops between employees, marks the run as stopped early and returns — it never lets the
 * platform kill it mid-run and never reports an interrupted run as complete.
 */
const TIME_BUDGET_MS = (maxDuration - 15) * 1000;

async function handle(request: Request): Promise<Response> {
  assertInternalJobRequest(request);
  // Only the server-side time budget is passed in. The request body, query string and headers are
  // never read, so a caller cannot choose a company, a date or a budget.
  const summary = await runScheduledAttendanceProcessing({ timeBudgetMs: TIME_BUDGET_MS });
  return apiSuccess(summary);
}

/**
 * Vercel Cron invokes the configured path with GET (sending `Authorization: Bearer $CRON_SECRET`),
 * so GET is supported; POST remains for any other scheduler or manual operator call. Both require
 * the same secret. Other methods are not exported, so Next.js answers them with 405. A GET with side
 * effects is acceptable here only because it is secret-gated and idempotent.
 */
export const GET = withApiHandler(async (_requestId, request: Request) => handle(request));
export const POST = withApiHandler(async (_requestId, request: Request) => handle(request));
