import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { Card, CardContent } from "@/components/ui/card";
import { CorrectionsTab } from "@/components/attendance/issues/corrections-tab";
import { ExceptionsTab, type ExceptionsTabParams } from "@/components/attendance/issues/exceptions-tab";
import { IssuesOverviewTab } from "@/components/attendance/issues/issues-overview-tab";
import { availableIssuesTabs, resolveIssuesAccess, resolveIssuesTab } from "@/components/attendance/issues/issues-navigation";
import { IssuesTabs } from "@/components/attendance/issues/issues-tabs";
import { PageHeader } from "@/components/ui/page-header";

type SearchParams = ExceptionsTabParams & { tab?: string; status?: string };

/**
 * "Issues & Corrections" — one HR workspace over two separate concepts that stay separate
 * underneath: exceptions (problems the system detected) and correction requests (a workflow to
 * change attendance data). This page only chooses which existing view to show; each view's service
 * enforces its own permission (`attendance.report.view` for exceptions,
 * `attendance.correction.approve` for corrections), so hiding a tab here is UX, never the security
 * boundary. A tab the caller cannot use is not offered, and requesting it falls back to one they can.
 */
export default async function AttendanceIssuesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getRequestContext();

  if (ctx.role === "EMPLOYEE") {
    redirect("/attendance");
  }

  const access = resolveIssuesAccess(ctx.role);
  const params = await searchParams;
  const tab = resolveIssuesTab(params.tab, access);

  if (tab === null) {
    return (
      <div className="space-y-6">
        <PageHeader title="Issues & Corrections" />
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-slate-700">You don&apos;t have permission to view attendance issues or correction requests.</p>
            <p className="mt-1 text-xs text-slate-500">Contact your administrator if you need access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Issues & Corrections" description="Review attendance problems detected by the system and requests to correct attendance records." />

      <IssuesTabs tabs={availableIssuesTabs(access)} active={tab} />

      {tab === "all" && <IssuesOverviewTab ctx={ctx} />}
      {tab === "exceptions" && <ExceptionsTab ctx={ctx} params={params} />}
      {tab === "corrections" && <CorrectionsTab ctx={ctx} status={params.status} />}
    </div>
  );
}
