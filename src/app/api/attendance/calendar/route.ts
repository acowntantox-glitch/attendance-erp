import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { attendanceCalendarFiltersSchema } from "@/validations/attendance";
import { getAttendanceCalendar } from "@/domains/attendance/calendar/attendance-calendar.service";

export const GET = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = attendanceCalendarFiltersSchema.safeParse(params);
  if (!parsed.success) {
    throw new ValidationError("Invalid calendar filters.", parsed.error.flatten());
  }

  const { month, page, pageSize, ...filters } = parsed.data;
  const result = await getAttendanceCalendar(ctx, month, filters, { page: page ?? 1, pageSize: pageSize ?? 25 });
  return apiSuccess(result);
});
