import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { createShiftSchema } from "@/validations/workforce";
import { createShift, listShifts } from "@/domains/workforce/service";

export const GET = withApiHandler(async () => {
  const ctx = await getRequestContext();
  const shifts = await listShifts(ctx);
  return apiSuccess(shifts);
});

export const POST = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const body = await request.json().catch(() => null);
  const parsed = createShiftSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid shift data.", parsed.error.flatten());
  }
  const shift = await createShift(ctx, parsed.data);
  return apiSuccess(shift, { status: 201 });
});
