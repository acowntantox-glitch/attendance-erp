import { cookies } from "next/headers";
import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { logout } from "@/domains/auth/service";

export const POST = withApiHandler(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await logout(token);
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
  return apiSuccess({ success: true });
});
