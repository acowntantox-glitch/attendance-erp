import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { attendanceActionSchema } from "@/validations/attendance";
import { startBreak } from "@/domains/attendance/service";

type RouteParams = { params: Promise<{ id: string }> };

export const POST = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const body = await request.json().catch(() => ({}));
  const parsed = attendanceActionSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid break-start data.", parsed.error.flatten());
  }
  const event = await startBreak(ctx, id, parsed.data);
  return apiSuccess(event, { status: 201 });
});
