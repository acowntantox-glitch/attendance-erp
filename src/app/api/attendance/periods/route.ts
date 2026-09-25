import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { listAttendancePeriods } from "@/domains/attendance/periods/attendance-period.service";

/** No `POST /api/attendance/periods` — periods are never manually created; a row is lazily
 *  materialized the first time it's checked or closed (§25 — "do not create an unnecessary
 *  generic POST if the period should only be generated automatically"). */
export const GET = withApiHandler(async (_requestId, _request: Request) => {
  const ctx = await getRequestContext();
  const periods = await listAttendancePeriods(ctx);
  return apiSuccess(periods);
});
