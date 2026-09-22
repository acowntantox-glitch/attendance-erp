import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { getMyEmployeeRecord } from "@/domains/employee/service";

export const GET = withApiHandler(async () => {
  const ctx = await getRequestContext();
  const employee = await getMyEmployeeRecord(ctx);
  return apiSuccess(employee);
});
