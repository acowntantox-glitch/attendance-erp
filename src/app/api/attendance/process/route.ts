import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { processAttendanceDaySchema } from "@/validations/attendance";
import { processCompanyAttendanceDay, processEmployeeAttendanceDay } from "@/domains/attendance/processing/attendance-processing.service";

export const POST = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const body = await request.json().catch(() => null);
  const parsed = processAttendanceDaySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("A 'workDate' (YYYY-MM-DD) is required.", parsed.error.flatten());
  }

  if (parsed.data.employeeId) {
    const result = await processEmployeeAttendanceDay(ctx, { employeeId: parsed.data.employeeId, workDate: parsed.data.workDate });
    return apiSuccess(result);
  }

  const result = await processCompanyAttendanceDay(ctx, { workDate: parsed.data.workDate });
  return apiSuccess(result);
});
