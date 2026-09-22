import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { getMyCompany } from "@/domains/organization/service";

export const GET = withApiHandler(async () => {
  const ctx = await getRequestContext();
  const company = await getMyCompany(ctx);
  return apiSuccess(company);
});
