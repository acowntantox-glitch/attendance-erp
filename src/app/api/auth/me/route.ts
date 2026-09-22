import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";

export const GET = withApiHandler(async () => {
  const ctx = await getRequestContext();
  return apiSuccess({
    userId: ctx.userId,
    email: ctx.userEmail,
    companyId: ctx.companyId,
    role: ctx.role,
  });
});
