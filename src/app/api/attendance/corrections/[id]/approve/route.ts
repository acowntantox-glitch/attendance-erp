import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { reviewCorrectionSchema } from "@/validations/attendance";
import { approveCorrection } from "@/domains/attendance/service";

type RouteParams = { params: Promise<{ id: string }> };

export const POST = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const body = await request.json().catch(() => ({}));
  const parsed = reviewCorrectionSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid review data.", parsed.error.flatten());
  }
  const correction = await approveCorrection(ctx, id, parsed.data);
  return apiSuccess(correction);
});
