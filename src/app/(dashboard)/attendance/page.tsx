import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { getAttendanceDay, getCurrentSession } from "@/domains/attendance/service";
import { resolveEmployeeTimezone } from "@/domains/workforce/service";
import { Card, CardContent } from "@/components/ui/card";
import { AttendanceWorkspace } from "@/components/attendance/attendance-workspace";

export default async function MyAttendancePage() {
  const ctx = await getRequestContext();

  if (!ctx.employeeId) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">My Attendance</h1>
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            No employee record is linked to your account yet. Ask HR to link your login to your employee profile.
          </CardContent>
        </Card>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const [{ record, sessions }, { session: currentSession, hasOpenBreak }, employeeTimezone] = await Promise.all([
    getAttendanceDay(ctx, ctx.employeeId, today),
    getCurrentSession(ctx, ctx.employeeId),
    resolveEmployeeTimezone(ctx, ctx.employeeId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">My Attendance</h1>
        <p className="text-sm text-slate-500">Check in, check out, and review your attendance history.</p>
      </div>

      <AttendanceWorkspace
        employeeId={ctx.employeeId}
        canControl
        canRequestCorrection={can(ctx.role, "attendance.correction.request")}
        employeeTimezone={employeeTimezone}
        workDate={today}
        record={record}
        sessions={sessions}
        currentSession={currentSession}
        hasOpenBreak={hasOpenBreak}
      />
    </div>
  );
}
