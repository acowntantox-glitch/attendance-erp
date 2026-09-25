import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { listAttendancePeriods } from "@/domains/attendance/periods/attendance-period.service";
import { getMyCompany } from "@/domains/organization/service";
import { Card, CardContent } from "@/components/ui/card";
import { PeriodsTable } from "@/components/attendance/periods/periods-table";

/**
 * HR-only period lock/unlock console (Batch 8). Gated on holding either
 * `attendance.period.lock` or `attendance.period.unlock` — currently only HR_ADMIN (and the
 * implicit COMPANY_ADMIN/SUPER_ADMIN) hold either, per rbac.ts; HR_MANAGER holds neither today,
 * same as MANAGER/EMPLOYEE. `listAttendancePeriods` itself re-checks this independently, so this
 * page-level gate is a UX nicety, not the enforcement boundary.
 */
export default async function AttendancePeriodsPage() {
  const ctx = await getRequestContext();

  if (ctx.role === "EMPLOYEE") {
    redirect("/attendance");
  }

  const canClose = can(ctx.role, "attendance.period.lock");
  const canReopen = can(ctx.role, "attendance.period.unlock");

  if (!canClose && !canReopen) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Attendance Periods</h1>
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            You don&apos;t have permission to manage attendance periods.
          </CardContent>
        </Card>
      </div>
    );
  }

  const [periods, company] = await Promise.all([listAttendancePeriods(ctx), getMyCompany(ctx)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Attendance Periods</h1>
        <p className="text-sm text-slate-500">
          Close a month to prevent further attendance changes, processing, recalculation, and corrections for it. Historical
          attendance stays readable regardless of period status.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <PeriodsTable periods={periods} timezone={company.timezone} canClose={canClose} canReopen={canReopen} />
        </CardContent>
      </Card>
    </div>
  );
}
