import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { listAttendanceForEmployee } from "@/domains/attendance/service";
import { validateDateRange } from "@/validations/attendance";

type RouteParams = { params: Promise<{ id: string }> };

/** Daily attendance records for an employee within a date range. */
export const GET = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) {
    throw new ValidationError("Query params 'from' and 'to' (YYYY-MM-DD) are required.");
  }
  const rangeError = validateDateRange(from, to);
  if (rangeError) throw new ValidationError(rangeError);
  const records = await listAttendanceForEmployee(ctx, id, from, to);
  return apiSuccess(records);
});
