import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { getBranch, setBranchActive, updateBranch } from "@/domains/organization/service";
import { updateBranchSchema } from "@/validations/organization";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const branch = await getBranch(ctx, id);
  return apiSuccess(branch);
});

export const PATCH = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const body = await request.json().catch(() => null);
  const parsed = updateBranchSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid branch data.", parsed.error.flatten());
  }
  const branch = await updateBranch(ctx, id, parsed.data);
  return apiSuccess(branch);
});

export const DELETE = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const branch = await setBranchActive(ctx, id, false);
  return apiSuccess(branch);
});
