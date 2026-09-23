import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { getWorkforceDashboardSummary } from "@/domains/workforce/service";

export const GET = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? undefined;
  const summary = await getWorkforceDashboardSummary(ctx, date);
  return apiSuccess(summary);
});
