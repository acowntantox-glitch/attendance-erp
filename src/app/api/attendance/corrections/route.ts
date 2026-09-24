import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { getRequestContext } from "@/lib/auth/request-context";
import { listCompanyCorrections } from "@/domains/attendance/service";

const VALID_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);

/** Company-wide correction queue, for approvers (HR_ADMIN/HR_MANAGER/COMPANY_ADMIN/SUPER_ADMIN). */
export const GET = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const statusParam = new URL(request.url).searchParams.get("status");
  const status = statusParam && VALID_STATUSES.has(statusParam) ? (statusParam as "PENDING" | "APPROVED" | "REJECTED") : undefined;
  const corrections = await listCompanyCorrections(ctx, status);
  return apiSuccess(corrections);
});
