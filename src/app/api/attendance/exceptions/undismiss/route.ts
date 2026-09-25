import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { undismissExceptionSchema } from "@/validations/attendance";
import { undismissException } from "@/domains/attendance/exceptions/attendance-exception.service";

export const POST = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const body = await request.json().catch(() => null);
  const parsed = undismissExceptionSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid undismiss request data.", parsed.error.flatten());
  }
  const removed = await undismissException(ctx, parsed.data);
  return apiSuccess(removed);
});
