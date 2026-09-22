import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { getBranch } from "@/domains/organization/service";

export const GET = withApiHandler(async (_requestId, _request: Request, ctxParams: { params: Promise<{ id: string }> }) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const branch = await getBranch(ctx, id);
  return apiSuccess(branch);
});
