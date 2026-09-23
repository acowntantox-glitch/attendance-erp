import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { setWeeklyOffRuleSchema } from "@/validations/workforce";
import { getCompanyDefaultWeeklyOff, setCompanyDefaultWeeklyOff } from "@/domains/workforce/service";

export const GET = withApiHandler(async () => {
  const ctx = await getRequestContext();
  const rule = await getCompanyDefaultWeeklyOff(ctx);
  return apiSuccess(rule);
});

export const PUT = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const body = await request.json().catch(() => null);
  const parsed = setWeeklyOffRuleSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid weekly off data.", parsed.error.flatten());
  }
  const rule = await setCompanyDefaultWeeklyOff(ctx, parsed.data);
  return apiSuccess(rule);
});
