import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { createWorkScheduleSchema } from "@/validations/workforce";
import { createWorkSchedule, listWorkSchedules } from "@/domains/workforce/service";

export const GET = withApiHandler(async () => {
  const ctx = await getRequestContext();
  const schedules = await listWorkSchedules(ctx);
  return apiSuccess(schedules);
});

export const POST = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const body = await request.json().catch(() => null);
  const parsed = createWorkScheduleSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid work schedule data.", parsed.error.flatten());
  }
  const schedule = await createWorkSchedule(ctx, parsed.data);
  return apiSuccess(schedule, { status: 201 });
});
