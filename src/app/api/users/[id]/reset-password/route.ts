import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { userIdParamSchema } from "@/validations/auth";
import { resetUserPassword } from "@/domains/auth/user-management.service";

/** Returns the one-time temporary password exactly once, so the response must never be cached. */
export const POST = withApiHandler(async (_requestId, _request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getRequestContext();

  const id = userIdParamSchema.safeParse((await params).id);
  if (!id.success) throw new ValidationError("Invalid user id.");

  const response = apiSuccess(await resetUserPassword(ctx, id.data));
  response.headers.set("Cache-Control", "no-store");
  return response;
});
