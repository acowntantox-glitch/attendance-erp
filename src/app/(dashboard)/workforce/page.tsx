import Link from "next/link";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { getWorkforceDashboardSummary } from "@/domains/workforce/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WorkforceSubNav } from "@/components/workforce/workforce-subnav";

export default async function WorkforceDashboardPage() {
  const ctx = await getRequestContext();
  const canViewDashboard = can(ctx.role, "workforce_dashboard.view");
  const canViewShifts = can(ctx.role, "shift.view");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Workforce</h1>
        <p className="text-sm text-slate-500">Today&apos;s operational overview across schedules and shifts.</p>
      </div>

      <WorkforceSubNav role={ctx.role} />

      {!canViewDashboard ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            You don&apos;t have permission to view the workforce dashboard.
          </CardContent>
        </Card>
      ) : (
        <DashboardContent canViewShifts={canViewShifts} ctx={ctx} />
      )}
    </div>
  );
}

async function DashboardContent({
  canViewShifts,
  ctx,
}: {
  canViewShifts: boolean;
  ctx: Awaited<ReturnType<typeof getRequestContext>>;
}) {
  const summary = await getWorkforceDashboardSummary(ctx);

  const cards = [
    { label: "Scheduled Today", value: summary.employeesScheduledToday },
    { label: "Off Today", value: summary.employeesOffToday },
    { label: "On Holiday Today", value: summary.employeesOnHolidayToday },
    { label: "Active Shifts", value: summary.activeShiftCount, href: canViewShifts ? "/workforce/shifts" : undefined },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const content = (
            <Card className={card.href ? "transition-colors hover:border-blue-300" : undefined}>
              <CardHeader>
                <CardTitle>{card.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-slate-900">{card.value}</p>
              </CardContent>
            </Card>
          );
          return card.href ? (
            <Link key={card.label} href={card.href} aria-label={`${card.label}: view shifts`}>
              {content}
            </Link>
          ) : (
            <div key={card.label}>{content}</div>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming Schedule Changes (next 14 days)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {summary.upcomingScheduleChanges.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-slate-400">No upcoming schedule changes in the next 14 days.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>Effective From</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.upcomingScheduleChanges.map((change) => (
                  <TableRow key={change.id}>
                    <TableCell>
                      <span className="font-medium text-slate-900">
                        {change.employee.firstName} {change.employee.lastName}
                      </span>
                      <span className="ml-2 text-xs text-slate-400">{change.employee.employeeNumber}</span>
                    </TableCell>
                    <TableCell>{change.workSchedule.name}</TableCell>
                    <TableCell>{change.shift?.name ?? "—"}</TableCell>
                    <TableCell>{change.effectiveFrom}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
