import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { setHolidayActive } from "@/domains/workforce/service";

export const POST = withApiHandler(
  async (_requestId, _request: Request, ctxParams: { params: Promise<{ id: string }> }) => {
    const ctx = await getRequestContext();
    const { id } = await ctxParams.params;
    const holiday = await setHolidayActive(ctx, id, true);
    return apiSuccess(holiday);
  },
);
