import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { archiveEmployeeDocument } from "@/domains/employee/service";

export const DELETE = withApiHandler(
  async (_requestId, _request: Request, ctxParams: { params: Promise<{ id: string; documentId: string }> }) => {
    const ctx = await getRequestContext();
    const { id, documentId } = await ctxParams.params;
    const document = await archiveEmployeeDocument(ctx, id, documentId);
    return apiSuccess(document);
  },
);
