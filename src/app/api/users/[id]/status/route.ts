import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { setUserStatusSchema, userIdParamSchema } from "@/validations/auth";
import { setUserActive } from "@/domains/auth/user-management.service";

export const PATCH = withApiHandler(async (_requestId, request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getRequestContext();

  const id = userIdParamSchema.safeParse((await params).id);
  if (!id.success) throw new ValidationError("Invalid user id.");

  const body = await request.json().catch(() => null);
  const parsed = setUserStatusSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError("Invalid status request.", parsed.error.flatten());

  return apiSuccess(await setUserActive(ctx, id.data, parsed.data.active));
});
