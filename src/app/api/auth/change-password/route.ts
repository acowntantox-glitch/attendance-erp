import { cookies } from "next/headers";
import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContextAllowingPasswordChange } from "@/lib/auth/request-context";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { changePasswordSchema } from "@/validations/auth";
import { changeOwnPassword } from "@/domains/auth/password.service";

/**
 * Self-service password change. Uses the one context resolver that still works while a password
 * change is being forced (an account whose password an admin reset can reach nothing else), but it
 * still requires a valid, active session. All of the user's sessions are revoked on success, so the
 * cookie is cleared and the client goes back to the login page.
 */
export const POST = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContextAllowingPasswordChange();

  const body = await request.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid password change request.", parsed.error.flatten());
  }

  await changeOwnPassword(ctx, { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.newPassword });

  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  return apiSuccess({ success: true, reauthenticate: true });
});
