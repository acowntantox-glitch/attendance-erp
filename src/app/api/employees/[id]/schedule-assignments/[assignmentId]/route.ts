import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { updateEmployeeScheduleAssignmentSchema } from "@/validations/workforce";
import { updateEmployeeScheduleAssignment } from "@/domains/workforce/service";

type RouteParams = { params: Promise<{ id: string; assignmentId: string }> };

export const PATCH = withApiHandler(async (_requestId, request: Request, ctxParams: RouteParams) => {
  const ctx = await getRequestContext();
  const { assignmentId } = await ctxParams.params;
  const body = await request.json().catch(() => null);
  const parsed = updateEmployeeScheduleAssignmentSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid schedule assignment data.", parsed.error.flatten());
  }
  const assignment = await updateEmployeeScheduleAssignment(ctx, assignmentId, parsed.data);
  return apiSuccess(assignment);
});
