import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { getDesignation, setDesignationActive, updateDesignation } from "@/domains/organization/service";
import { updateDesignationSchema } from "@/validations/organization";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const designation = await getDesignation(ctx, id);
  return apiSuccess(designation);
});

export const PATCH = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const body = await request.json().catch(() => null);
  const parsed = updateDesignationSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid designation data.", parsed.error.flatten());
  }
  const designation = await updateDesignation(ctx, id, parsed.data);
  return apiSuccess(designation);
});

export const DELETE = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const designation = await setDesignationActive(ctx, id, false);
  return apiSuccess(designation);
});
