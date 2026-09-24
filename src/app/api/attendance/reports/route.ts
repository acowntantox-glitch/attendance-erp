import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { attendanceReportFiltersSchema } from "@/validations/attendance";
import { getAttendanceReport } from "@/domains/attendance/reports/attendance-report.service";

export const GET = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = attendanceReportFiltersSchema.safeParse(params);
  if (!parsed.success) {
    throw new ValidationError("Invalid report filters.", parsed.error.flatten());
  }

  const { page, pageSize, ...filters } = parsed.data;
  const result = await getAttendanceReport(ctx, filters, { page: page ?? 1, pageSize: pageSize ?? 25 });
  return apiSuccess(result);
});
