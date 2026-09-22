import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { createEmployeeSchema, listEmployeesQuerySchema } from "@/validations/employee";
import { createEmployee, listEmployees } from "@/domains/employee/service";

export const GET = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const searchParams = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listEmployeesQuerySchema.safeParse(searchParams);
  if (!parsed.success) {
    throw new ValidationError("Invalid query parameters.", parsed.error.flatten());
  }
  const result = await listEmployees(ctx, parsed.data);
  return apiSuccess(result);
});

export const POST = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const body = await request.json().catch(() => null);
  const parsed = createEmployeeSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid employee data.", parsed.error.flatten());
  }
  const employee = await createEmployee(ctx, parsed.data);
  return apiSuccess(employee, { status: 201 });
});
