import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { assignEmployeeScheduleSchema } from "@/validations/workforce";
import { assignEmployeeSchedule, listEmployeeScheduleAssignments } from "@/domains/workforce/service";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (_requestId, _request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const assignments = await listEmployeeScheduleAssignments(ctx, id);
  return apiSuccess(assignments);
});

export const POST = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { id } = await ctxParams.params;
  const body = await request.json().catch(() => null);
  const parsed = assignEmployeeScheduleSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid schedule assignment data.", parsed.error.flatten());
  }
  const assignment = await assignEmployeeSchedule(ctx, id, parsed.data);
  return apiSuccess(assignment, { status: 201 });
});
