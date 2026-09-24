import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { getEmployee } from "@/domains/employee/service";
import { EmployeeNotFoundError } from "@/domains/employee/errors";
import { AuthorizationError } from "@/lib/errors";
import { getAttendanceDay, getCurrentSession } from "@/domains/attendance/service";
import { resolveEmployeeTimezone } from "@/domains/workforce/service";
import { Card, CardContent } from "@/components/ui/card";
import { AttendanceWorkspace } from "@/components/attendance/attendance-workspace";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Authorized (HR/admin) viewing of a specific employee's attendance, per `attendance.view`. An
 * EMPLOYEE-role caller is always redirected to their own canonical `/attendance` page instead —
 * never rendered this route with someone else's id, matching the server-side self-scope rule
 * already established by the Batch 1 attendance service (which would silently return the
 * caller's own data regardless of `id` for that role, but funneling to the dedicated route avoids
 * any confusing "your own data at someone else's URL" experience).
 */
export default async function EmployeeAttendancePage({ params }: RouteParams) {
  const ctx = await getRequestContext();
  const { id } = await params;

  if (ctx.role === "EMPLOYEE") {
    redirect("/attendance");
  }

  if (!can(ctx.role, "attendance.view")) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Attendance</h1>
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            You don&apos;t have permission to view attendance records.
          </CardContent>
        </Card>
      </div>
    );
  }

  let employee;
  try {
    employee = await getEmployee(ctx, id);
  } catch (error) {
    if (error instanceof EmployeeNotFoundError) notFound();
    if (error instanceof AuthorizationError) {
      return (
        <div className="space-y-6">
          <h1 className="text-lg font-semibold text-slate-900">Attendance</h1>
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-400">
              You don&apos;t have permission to view this employee&apos;s attendance.
            </CardContent>
          </Card>
        </div>
      );
    }
    throw error;
  }

  const today = new Date().toISOString().slice(0, 10);
  const [{ record, sessions }, { session: currentSession, hasOpenBreak }, employeeTimezone] = await Promise.all([
    getAttendanceDay(ctx, id, today),
    getCurrentSession(ctx, id),
    resolveEmployeeTimezone(ctx, id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/employees/${id}`} className="text-sm text-blue-700 hover:underline">
          ← Back to profile
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">
          {employee.firstName} {employee.lastName}&apos;s Attendance
        </h1>
        <p className="text-sm text-slate-500">Read-only view — HR-initiated check-in/out on behalf of an employee is not available yet.</p>
      </div>

      <AttendanceWorkspace
        employeeId={id}
        canControl={false}
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
