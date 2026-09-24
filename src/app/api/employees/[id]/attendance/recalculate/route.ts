import { z } from "zod";
import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { recalculateDailyRecord } from "@/domains/attendance/service";

type RouteParams = { params: Promise<{ id: string }> };
const bodySchema = z.object({ workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export const POST = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("A 'workDate' (YYYY-MM-DD) is required.", parsed.error.flatten());
  }
  const record = await recalculateDailyRecord(ctx, id, parsed.data.workDate);
  return apiSuccess(record);
});
