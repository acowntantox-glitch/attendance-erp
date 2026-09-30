import type { RequestContext } from "@/lib/auth/request-context";
import { listCompanyCorrections } from "@/domains/attendance/service";
import { isAttendancePeriodClosed } from "@/domains/attendance/periods/attendance-period.service";
import { getMyCompany } from "@/domains/organization/service";
import { Card, CardContent } from "@/components/ui/card";
import { CorrectionsStatusFilter } from "@/components/attendance/corrections/corrections-status-filter";
import { HrCorrectionsTable } from "@/components/attendance/corrections/hr-corrections-table";
import { ISSUES_BASE_PATH } from "./issues-navigation";

const VALID_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);

/**
 * The "Correction Requests" tab: the unchanged HR correction queue (status filter, table, approve/
 * reject dialog), moved here from the old `/attendance/corrections` page. Approval, rejection,
 * hierarchy rules, recalculation and period locking all live in the existing correction service;
 * `listCompanyCorrections` re-checks `attendance.correction.approve` itself.
 */
export async function CorrectionsTab({ ctx, status: statusParam }: { ctx: RequestContext; status: string | undefined }) {
  const status = statusParam && statusParam !== "ALL" && VALID_STATUSES.has(statusParam) ? (statusParam as "PENDING" | "APPROVED" | "REJECTED") : "PENDING";
  const effectiveFilter = statusParam && VALID_STATUSES.has(statusParam) ? statusParam : statusParam === "ALL" ? "ALL" : "PENDING";

  const [corrections, company] = await Promise.all([
    listCompanyCorrections(ctx, effectiveFilter === "ALL" ? undefined : status),
    getMyCompany(ctx),
  ]);

  // One closed-period lookup per distinct month present in this view, not per correction — a
  // correction's own workDate month is what determines whether its period blocks a new review, not
  // the request's creation date.
  const distinctMonths = Array.from(new Set(corrections.map((c) => c.workDate.slice(0, 7))));
  const closedFlags = await Promise.all(distinctMonths.map((month) => isAttendancePeriodClosed(ctx.companyId, month)));
  const closedMonths = new Set(distinctMonths.filter((_, i) => closedFlags[i]));

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Requests to change or correct attendance records. Approving a correction recalculates the affected attendance day immediately.
      </p>

      <CorrectionsStatusFilter basePath={ISSUES_BASE_PATH} extraParams={{ tab: "corrections" }} status={effectiveFilter} />

      <Card>
        <CardContent className="p-0">
          <HrCorrectionsTable corrections={corrections} timezone={company.timezone} closedMonths={closedMonths} />
        </CardContent>
      </Card>
    </div>
  );
}
