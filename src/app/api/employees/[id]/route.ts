import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { updateEmployeeSchema } from "@/validations/employee";
import { archiveEmployee, getEmployee, updateEmployee } from "@/domains/employee/service";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const employee = await getEmployee(ctx, id);
  return apiSuccess(employee);
});

export const PATCH = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const body = await request.json().catch(() => null);
  const parsed = updateEmployeeSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid employee data.", parsed.error.flatten());
  }
  const employee = await updateEmployee(ctx, id, parsed.data);
  return apiSuccess(employee);
});

export const DELETE = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const employee = await archiveEmployee(ctx, id);
  return apiSuccess(employee);
});
