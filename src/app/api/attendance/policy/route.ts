import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { updateAttendancePolicySchema } from "@/validations/attendance";
import { getAttendancePolicy, updateAttendancePolicy } from "@/domains/attendance/policy/attendance-policy.service";

/** The company comes only from the authenticated request context — the body carries no company id. */
export const GET = withApiHandler(async () => {
  const ctx = await getRequestContext();
  return apiSuccess(await getAttendancePolicy(ctx));
});

export const PUT = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const body = await request.json().catch(() => null);
  const parsed = updateAttendancePolicySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid attendance policy.", parsed.error.flatten());
  }
  return apiSuccess(await updateAttendancePolicy(ctx, parsed.data));
});
