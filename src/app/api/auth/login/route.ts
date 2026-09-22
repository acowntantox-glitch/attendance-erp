import { cookies } from "next/headers";
import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { loginSchema } from "@/validations/auth";
import { login } from "@/domains/auth/service";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { isProduction } from "@/config/env";

export const POST = withApiHandler(async (_requestId, request: Request) => {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid login request.", parsed.error.flatten());
  }

  const result = await login(parsed.data.email, parsed.data.password, parsed.data.companyId);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, result.token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires: result.expiresAt,
  });

  return apiSuccess({ user: result.user, company: result.company });
});
