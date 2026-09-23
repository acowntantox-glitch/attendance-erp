import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { updateShiftSchema } from "@/validations/workforce";
import { getShift, setShiftActive, updateShift } from "@/domains/workforce/service";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const shift = await getShift(ctx, id);
  return apiSuccess(shift);
});

export const PATCH = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const body = await request.json().catch(() => null);
  const parsed = updateShiftSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid shift data.", parsed.error.flatten());
  }
  const shift = await updateShift(ctx, id, parsed.data);
  return apiSuccess(shift);
});

export const DELETE = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const shift = await setShiftActive(ctx, id, false);
  return apiSuccess(shift);
});
