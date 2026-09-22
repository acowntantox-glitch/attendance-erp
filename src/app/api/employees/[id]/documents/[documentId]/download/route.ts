import { withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { getEmployeeDocumentDownload } from "@/domains/employee/service";

/**
 * Proxy download: streams the file through this server rather than handing out a presigned S3
 * URL, so every download re-runs the full RBAC/tenant-isolation/self-view check via
 * getRequestContext() + the service layer — see docs and the storage module for why.
 */
export const GET = withApiHandler(
  async (_requestId, _request: Request, ctxParams: { params: Promise<{ id: string; documentId: string }> }) => {
    const ctx = await getRequestContext();
    const { id, documentId } = await ctxParams.params;
    const { body, contentType, contentLength, filename } = await getEmployeeDocumentDownload(ctx, id, documentId);

    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(contentLength),
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  },
);
