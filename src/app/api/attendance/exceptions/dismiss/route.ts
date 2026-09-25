import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { dismissExceptionSchema } from "@/validations/attendance";
import { dismissException } from "@/domains/attendance/exceptions/attendance-exception.service";

export const POST = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const body = await request.json().catch(() => null);
  const parsed = dismissExceptionSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid dismissal request data.", parsed.error.flatten());
  }
  const dismissal = await dismissException(ctx, parsed.data);
  return apiSuccess(dismissal, { status: 201 });
});
