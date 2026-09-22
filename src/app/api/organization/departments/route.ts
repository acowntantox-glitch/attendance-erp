import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { createDepartmentSchema } from "@/validations/organization";
import { createDepartment, listDepartments } from "@/domains/organization/service";

export const GET = withApiHandler(async () => {
  const ctx = await getRequestContext();
  const departments = await listDepartments(ctx);
  return apiSuccess(departments);
});

export const POST = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const body = await request.json().catch(() => null);
  const parsed = createDepartmentSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid department data.", parsed.error.flatten());
  }
  const department = await createDepartment(ctx, parsed.data);
  return apiSuccess(department, { status: 201 });
});
