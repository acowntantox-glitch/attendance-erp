import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { getAttendanceDay } from "@/domains/attendance/service";
import { dateSchema } from "@/validations/attendance";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const date = new URL(request.url).searchParams.get("date");
  if (!date || !dateSchema.safeParse(date).success) {
    throw new ValidationError("Query param 'date' (a real YYYY-MM-DD date) is required.");
  }
  const day = await getAttendanceDay(ctx, id, date);
  return apiSuccess(day);
});
