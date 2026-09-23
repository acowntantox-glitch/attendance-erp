import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { updateHolidaySchema } from "@/validations/workforce";
import { getHoliday, setHolidayActive, updateHoliday } from "@/domains/workforce/service";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const holiday = await getHoliday(ctx, id);
  return apiSuccess(holiday);
});

export const PATCH = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const body = await request.json().catch(() => null);
  const parsed = updateHolidaySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid holiday data.", parsed.error.flatten());
  }
  const holiday = await updateHoliday(ctx, id, parsed.data);
  return apiSuccess(holiday);
});

export const DELETE = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const holiday = await setHolidayActive(ctx, id, false);
  return apiSuccess(holiday);
});
