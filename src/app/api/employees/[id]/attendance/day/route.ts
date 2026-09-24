import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { getAttendanceDay } from "@/domains/attendance/service";

type RouteParams = { params: Promise<{ id: string }> };
const dateParam = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const date = new URL(request.url).searchParams.get("date");
  if (!date || !dateParam.test(date)) {
    throw new ValidationError("Query param 'date' (YYYY-MM-DD) is required.");
  }
  const day = await getAttendanceDay(ctx, id, date);
  return apiSuccess(day);
});
