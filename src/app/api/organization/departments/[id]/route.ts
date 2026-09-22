import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { getDepartment, setDepartmentActive, updateDepartment } from "@/domains/organization/service";
import { updateDepartmentSchema } from "@/validations/organization";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const department = await getDepartment(ctx, id);
  return apiSuccess(department);
});

export const PATCH = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const body = await request.json().catch(() => null);
  const parsed = updateDepartmentSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid department data.", parsed.error.flatten());
  }
  const department = await updateDepartment(ctx, id, parsed.data);
  return apiSuccess(department);
});

export const DELETE = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const department = await setDepartmentActive(ctx, id, false);
  return apiSuccess(department);
});
