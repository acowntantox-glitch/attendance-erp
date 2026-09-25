import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { getEmployee } from "@/domains/employee/service";
import { EmployeeNotFoundError } from "@/domains/employee/errors";
import { AuthorizationError } from "@/lib/errors";
import { getAttendanceInvestigation } from "@/domains/attendance/investigation/attendance-investigation.service";
import { resolveEmployeeTimezone } from "@/domains/workforce/service";
import { dateSchema } from "@/validations/attendance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateSelector } from "@/components/attendance/dashboard/date-selector";
import { SessionsTable } from "@/components/attendance/sessions-table";
import { InvestigationHeader } from "@/components/attendance/investigation/investigation-header";
import { WorkforceExpectationCard } from "@/components/attendance/investigation/workforce-expectation-card";
import { InvestigationSummaryCard } from "@/components/attendance/investigation/investigation-summary-card";
import { EventTimeline } from "@/components/attendance/investigation/event-timeline";
import { DayCorrectionsTable } from "@/components/attendance/investigation/day-corrections-table";

type RouteParams = { params: Promise<{ id: string }>; searchParams: Promise<{ date?: string }> };

/**
 * Authorized (HR/admin) investigation of a specific employee's attendance on a specific date, per
 * `attendance.view` — Batch 9. An EMPLOYEE-role caller is always redirected to their own canonical
 * `/attendance` page instead — never rendered this route with someone else's id, matching the
 * server-side self-scope rule already established by the Batch 1 attendance service (which would
 * silently return the caller's own data regardless of `id` for that role, but funneling to the
 * dedicated route avoids any confusing "your own data at someone else's URL" experience). Mostly
 * a read-only investigation screen — no check-in/out/break controls, no correction approve/reject
 * (that stays on `/attendance/corrections`, the HR review queue) — with one exception: requesting
 * a *new* correction is exposed here too (restored post-Batch-9-audit, see
 * `DayCorrectionsTable`/`InvestigationCorrectionAction`), reusing the exact same
 * `RequestCorrectionDialog`/`requestCorrection` the self-service `/attendance` page already uses,
 * gated the same way it always was: `attendance.correction.request` + an open period.
 */
export default async function EmployeeAttendancePage({ params, searchParams }: RouteParams) {
  const ctx = await getRequestContext();
  const { id } = await params;
  const { date: dateParam } = await searchParams;

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

  const today = new Date().toISOString().slice(0, 10);
  const parsedDate = dateParam ? dateSchema.safeParse(dateParam) : null;
  const date = parsedDate?.success ? parsedDate.data : today;

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

  const [investigation, employeeTimezone] = await Promise.all([
    getAttendanceInvestigation(ctx, id, date),
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
        <p className="text-sm text-slate-500">Read-only investigation view — HR-initiated check-in/out on behalf of an employee is not available yet.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <InvestigationHeader employee={employee} />
        </CardContent>
      </Card>

      <DateSelector basePath={`/employees/${id}/attendance`} date={date} today={today} otherParams={{}} />

      {investigation.periodClosed && (
        <div role="status" className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          This month&apos;s attendance period is closed. Historical information below remains fully viewable, but nothing on this date
          can be changed, processed, or recalculated until the period is reopened.
        </div>
      )}

      <WorkforceExpectationCard dayInfo={investigation.workforceExpectation} />

      <InvestigationSummaryCard record={investigation.record} />

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <SessionsTable sessions={investigation.sessions} />
        </CardContent>
      </Card>

      <EventTimeline events={investigation.events} timezone={employeeTimezone} />

      <DayCorrectionsTable
        corrections={investigation.corrections}
        timezone={employeeTimezone}
        employeeId={id}
        workDate={date}
        canRequestCorrection={can(ctx.role, "attendance.correction.request")}
        periodClosed={investigation.periodClosed}
      />
    </div>
  );
}
