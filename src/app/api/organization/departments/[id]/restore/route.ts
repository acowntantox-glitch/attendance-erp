import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { setDepartmentActive } from "@/domains/organization/service";

export const POST = withApiHandler(
  async (_requestId, _request: Request, ctxParams: { params: Promise<{ id: string }> }) => {
    const ctx = await getRequestContext();
    const { id } = await ctxParams.params;
    const department = await setDepartmentActive(ctx, id, true);
    return apiSuccess(department);
  },
);
