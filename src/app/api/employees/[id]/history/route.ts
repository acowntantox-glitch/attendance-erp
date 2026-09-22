import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { listEmployeeHistory } from "@/domains/employee/service";

export const GET = withApiHandler(
  async (_requestId, _request: Request, ctxParams: { params: Promise<{ id: string }> }) => {
    const ctx = await getRequestContext();
    const { id } = await ctxParams.params;
    const history = await listEmployeeHistory(ctx, id);
    return apiSuccess(history);
  },
);
