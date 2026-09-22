import { z } from "zod";
import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { updateOnboardingTask } from "@/domains/employee/service";

const toggleTaskSchema = z.object({ isCompleted: z.boolean() });

export const PATCH = withApiHandler(
  async (_requestId, request: Request, ctxParams: { params: Promise<{ id: string; taskId: string }> }) => {
    const ctx = await getRequestContext();
    const { id, taskId } = await ctxParams.params;
    const body = await request.json().catch(() => null);
    const parsed = toggleTaskSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request.", parsed.error.flatten());
    }
    const onboarding = await updateOnboardingTask(ctx, id, taskId, parsed.data.isCompleted);
    return apiSuccess(onboarding);
  },
);
