import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { monthSchema } from "@/validations/attendance";
import { previewAttendancePeriodClose } from "@/domains/attendance/periods/attendance-period.service";

type RouteParams = { params: Promise<{ month: string }> };

/** Read-only — used by the close confirmation dialog to show open-session/unprocessed-day counts
 *  before HR confirms (§18/§19). Never itself closes anything. */
export const GET = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { month } = await ctxParams.params;
  const parsed = monthSchema.safeParse(month);
  if (!parsed.success) {
    throw new ValidationError("Invalid period month.", parsed.error.flatten());
  }
  const preview = await previewAttendancePeriodClose(ctx, parsed.data);
  return apiSuccess(preview);
});
