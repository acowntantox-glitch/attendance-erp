import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { assertInternalJobRequest } from "@/lib/auth/internal-job";
import { runScheduledAttendanceProcessing } from "@/domains/attendance/processing/attendance-auto-processing.service";

// Never cached or statically evaluated: every call must run the job.
export const dynamic = "force-dynamic";

/**
 * Scheduled attendance processing (Batch 13). Authenticated by the shared `INTERNAL_JOB_SECRET`
 * only — not by a user session. The request body and query string are ignored entirely: the
 * companies, dates and lag are decided server-side, so a caller cannot choose a tenant. Safe to
 * call repeatedly (idempotent) and concurrently (per company/date advisory lock).
 */
export const POST = withApiHandler(async (_requestId, request: Request) => {
  assertInternalJobRequest(request);
  const summary = await runScheduledAttendanceProcessing();
  return apiSuccess(summary);
});
