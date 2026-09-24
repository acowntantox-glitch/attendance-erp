import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { listCompanyCorrections } from "@/domains/attendance/service";
import { getMyCompany } from "@/domains/organization/service";
import { Card, CardContent } from "@/components/ui/card";
import { CorrectionsStatusFilter } from "@/components/attendance/corrections/corrections-status-filter";
import { HrCorrectionsTable } from "@/components/attendance/corrections/hr-corrections-table";

type SearchParams = { status?: string };

const VALID_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);

/**
 * HR-only correction queue. Gated on `attendance.correction.approve` — the same permission that
 * gates `listCompanyCorrections` server-side, so this page-level check is a UX nicety, not the
 * actual enforcement boundary (the backend rejects the call independently either way). EMPLOYEE
 * and MANAGER never see this route in the sidebar; MANAGER is additionally redirected here since
 * the batch's RBAC table gives it correction.request but not the company-wide queue.
 */
export default async function AttendanceCorrectionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getRequestContext();

  if (!can(ctx.role, "attendance.correction.approve")) {
    if (ctx.role === "EMPLOYEE") redirect("/attendance");
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Attendance Corrections</h1>
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            You don&apos;t have permission to review attendance corrections.
          </CardContent>
        </Card>
      </div>
    );
  }

  const params = await searchParams;
  const statusParam = params.status && params.status !== "ALL" ? params.status : undefined;
  const status = statusParam && VALID_STATUSES.has(statusParam) ? (statusParam as "PENDING" | "APPROVED" | "REJECTED") : "PENDING";
  const effectiveFilter = params.status && VALID_STATUSES.has(params.status) ? params.status : params.status === "ALL" ? "ALL" : "PENDING";

  const [corrections, company] = await Promise.all([
    listCompanyCorrections(ctx, effectiveFilter === "ALL" ? undefined : status),
    getMyCompany(ctx),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Attendance Corrections</h1>
        <p className="text-sm text-slate-500">
          Review employee and manager correction requests. Approving a correction recalculates the affected attendance day immediately.
        </p>
      </div>

      <CorrectionsStatusFilter basePath="/attendance/corrections" status={effectiveFilter} />

      <Card>
        <CardContent className="p-0">
          <HrCorrectionsTable corrections={corrections} timezone={company.timezone} />
        </CardContent>
      </Card>
    </div>
  );
}
