import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { getCorrectionDetail } from "@/domains/attendance/service";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const correction = await getCorrectionDetail(ctx, id);
  return apiSuccess(correction);
});
