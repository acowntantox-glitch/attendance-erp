import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { getAttendanceDay, getCurrentSession } from "@/domains/attendance/service";
import { isAttendancePeriodClosed } from "@/domains/attendance/periods/attendance-period.service";
import { resolveEmployeeTimezone } from "@/domains/workforce/service";
import { Card, CardContent } from "@/components/ui/card";
import { AttendanceWorkspace } from "@/components/attendance/attendance-workspace";
import { PageHeader } from "@/components/ui/page-header";

export default async function MyAttendancePage() {
  const ctx = await getRequestContext();

  if (!ctx.employeeId) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Attendance" />
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-slate-700">No employee record is linked to your account yet.</p>
            <p className="mt-1 text-xs text-slate-500">Ask HR to link your login to your employee profile.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const [{ record, sessions }, { session: currentSession, hasOpenBreak }, employeeTimezone, periodClosed] = await Promise.all([
    getAttendanceDay(ctx, ctx.employeeId, today),
    getCurrentSession(ctx, ctx.employeeId),
    resolveEmployeeTimezone(ctx, ctx.employeeId),
    isAttendancePeriodClosed(ctx.companyId, today.slice(0, 7)),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="My Attendance" description="Check in, check out, and review your attendance history." />

      <AttendanceWorkspace
        employeeId={ctx.employeeId}
        canControl
        canRequestCorrection={can(ctx.role, "attendance.correction.request")}
        employeeTimezone={employeeTimezone}
        workDate={today}
        periodClosed={periodClosed}
        record={record}
        sessions={sessions}
        currentSession={currentSession}
        hasOpenBreak={hasOpenBreak}
      />
    </div>
  );
}
