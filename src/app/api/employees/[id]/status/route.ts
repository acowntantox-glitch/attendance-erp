import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { changeEmployeeStatusSchema } from "@/validations/employee";
import { changeEmployeeStatus } from "@/domains/employee/service";

export const PATCH = withApiHandler(
  async (_requestId, request: Request, ctxParams: { params: Promise<{ id: string }> }) => {
    const ctx = await getRequestContext();
    const { id } = await ctxParams.params;
    const body = await request.json().catch(() => null);
    const parsed = changeEmployeeStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid status change request.", parsed.error.flatten());
    }
    const employee = await changeEmployeeStatus(ctx, id, parsed.data.status, parsed.data.note);
    return apiSuccess(employee);
  },
);
