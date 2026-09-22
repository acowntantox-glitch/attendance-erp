import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { getOnboarding, startOnboarding } from "@/domains/employee/service";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const onboarding = await getOnboarding(ctx, id);
  return apiSuccess(onboarding);
});

export const POST = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const onboarding = await startOnboarding(ctx, id);
  return apiSuccess(onboarding, { status: 201 });
});
