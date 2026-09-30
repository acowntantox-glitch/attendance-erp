import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { listCompanyUsers } from "@/domains/auth/user-management.service";

/** Members of the caller's own company only; requires `user.manage`. Never includes a password hash. */
export const GET = withApiHandler(async () => {
  const ctx = await getRequestContext();
  return apiSuccess(await listCompanyUsers(ctx));
});
