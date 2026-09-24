import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { requestCorrectionSchema } from "@/validations/attendance";
import { listCorrectionsForEmployee, requestCorrection } from "@/domains/attendance/service";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const corrections = await listCorrectionsForEmployee(ctx, id);
  return apiSuccess(corrections);
});

export const POST = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const body = await request.json().catch(() => null);
  const parsed = requestCorrectionSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid correction request data.", parsed.error.flatten());
  }
  const correction = await requestCorrection(ctx, id, parsed.data);
  return apiSuccess(correction, { status: 201 });
});
