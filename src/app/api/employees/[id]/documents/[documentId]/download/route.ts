import { withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { getEmployeeDocumentDownload } from "@/domains/employee/service";
import { isAllowedDocumentType } from "@/validations/employee";

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
        // Only the document formats the upload allows are served as themselves; anything else (an object that
        // got into the bucket another way) is an opaque download. Always an attachment, never sniffed.
        "Content-Type": isAllowedDocumentType(contentType) ? contentType : "application/octet-stream",
        "Content-Length": String(contentLength),
        "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.\- ()]+/g, "_")}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  },
);
