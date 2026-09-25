import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { monthSchema } from "@/validations/attendance";
import { closeAttendancePeriod } from "@/domains/attendance/periods/attendance-period.service";

type RouteParams = { params: Promise<{ month: string }> };

export const POST = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { month } = await ctxParams.params;
  const parsed = monthSchema.safeParse(month);
  if (!parsed.success) {
    throw new ValidationError("Invalid period month.", parsed.error.flatten());
  }
  const period = await closeAttendancePeriod(ctx, parsed.data);
  return apiSuccess(period);
});
