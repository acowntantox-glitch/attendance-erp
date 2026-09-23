import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { setWeeklyOffRuleSchema } from "@/validations/workforce";
import { getEmployeeWeeklyOffOverride, setEmployeeWeeklyOffOverride } from "@/domains/workforce/service";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const rule = await getEmployeeWeeklyOffOverride(ctx, id);
  return apiSuccess(rule);
});

export const PUT = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const body = await request.json().catch(() => null);
  const parsed = setWeeklyOffRuleSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid weekly off data.", parsed.error.flatten());
  }
  const rule = await setEmployeeWeeklyOffOverride(ctx, id, parsed.data);
  return apiSuccess(rule);
});
