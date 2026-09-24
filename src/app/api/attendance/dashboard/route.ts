import { attendanceDailyStatusEnum } from "@/db/schema";
import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { getAttendanceDashboard } from "@/domains/attendance/service";
import type { AttendanceDailyStatus } from "@/domains/attendance/model";

const dateParam = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUSES = new Set(attendanceDailyStatusEnum.enumValues);

/** The HR/Manager attendance dashboard's single read query — summary counts, currently-working,
 *  late, incomplete, and the paginated table, all for one selected date. The page itself (a
 *  Server Component) calls the underlying service directly rather than this route; this endpoint
 *  exists for API completeness/external consumers, matching the workforce dashboard's own
 *  service+route pairing. */
export const GET = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const url = new URL(request.url);
  const params = url.searchParams;

  const date = params.get("date");
  if (!date || !dateParam.test(date)) {
    throw new ValidationError("Query param 'date' (YYYY-MM-DD) is required.");
  }

  const statusParam = params.get("status");
  if (statusParam && !VALID_STATUSES.has(statusParam as AttendanceDailyStatus)) {
    throw new ValidationError(`Invalid 'status'. Must be one of: ${[...VALID_STATUSES].join(", ")}.`);
  }

  const result = await getAttendanceDashboard(ctx, {
    workDate: date,
    page: Number(params.get("page") ?? "1") || 1,
    pageSize: Number(params.get("pageSize") ?? "25") || 25,
    search: params.get("search") || undefined,
    departmentId: params.get("departmentId") || undefined,
    locationId: params.get("locationId") || undefined,
    status: (statusParam as AttendanceDailyStatus) || undefined,
  });

  return apiSuccess(result);
});
