import Link from "next/link";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { getWorkforceDayInfoRange } from "@/domains/workforce/service";
import { listEmployees } from "@/domains/employee/service";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WorkforceSubNav } from "@/components/workforce/workforce-subnav";
import { CalendarEmployeeSelect } from "@/components/workforce/calendar-employee-select";
import { CalendarGrid } from "@/components/workforce/calendar-grid";
import { formatMonthLabel, formatMonthParam, getGridRange, parseMonthParam, shiftMonth, todayIso } from "@/components/workforce/calendar-month";
import type { WorkforceDayInfo } from "@/domains/workforce/model";

type SearchParams = { employeeId?: string; month?: string };

export default async function WorkforceCalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getRequestContext();
  const params = await searchParams;
  const canView = can(ctx.role, "workforce_calendar.view");
  const canSelectEmployees = ctx.role !== "EMPLOYEE" && can(ctx.role, "employee.view");

  const { year, month } = parseMonthParam(params.month);
  const monthParam = formatMonthParam(year, month);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const current = parseMonthParam(undefined);

  // EMPLOYEE is always pinned to their own record — the service layer enforces this too (see
  // getWorkforceDayInfo), this is only for building the right links/labels, never the security
  // boundary itself.
  const employeeId = ctx.role === "EMPLOYEE" ? ctx.employeeId : (params.employeeId ?? null);

  function monthHref(targetYear: number, targetMonth: number) {
    const qs = new URLSearchParams({ month: formatMonthParam(targetYear, targetMonth) });
    if (employeeId) qs.set("employeeId", employeeId);
    return `/workforce/calendar?${qs.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Workforce Calendar</h1>
        <p className="text-sm text-slate-500">Holiday, weekly-off, and schedule status for a selected employee.</p>
      </div>

      <WorkforceSubNav role={ctx.role} />

      {!canView ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            You don&apos;t have permission to view the workforce calendar.
          </CardContent>
        </Card>
      ) : ctx.role === "EMPLOYEE" && !employeeId ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            No employee record is linked to your account yet. Ask HR to link your login to your employee profile.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link href={monthHref(prev.year, prev.month)} aria-label="Previous month">
                <Button variant="secondary" size="sm">
                  ← Previous
                </Button>
              </Link>
              <h2 className="min-w-[10rem] text-center text-sm font-semibold text-slate-900">{formatMonthLabel(year, month)}</h2>
              <Link href={monthHref(next.year, next.month)} aria-label="Next month">
                <Button variant="secondary" size="sm">
                  Next →
                </Button>
              </Link>
              <Link href={monthHref(current.year, current.month)} aria-label="Jump to today">
                <Button variant="ghost" size="sm">
                  Today
                </Button>
              </Link>
            </div>

            {canSelectEmployees && (
              <CalendarEmployeeSelect
                month={monthParam}
                selectedEmployeeId={employeeId}
                employees={(
                  await listEmployees(ctx, { page: 1, pageSize: 100 })
                ).items.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, employeeNumber: e.employeeNumber }))}
              />
            )}
          </div>

          {!employeeId ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-slate-400">
                Select an employee above to view their workforce calendar.
              </CardContent>
            </Card>
          ) : (
            <CalendarMonth ctx={ctx} employeeId={employeeId} year={year} month={month} />
          )}
        </div>
      )}
    </div>
  );
}

async function CalendarMonth({
  ctx,
  employeeId,
  year,
  month,
}: {
  ctx: Awaited<ReturnType<typeof getRequestContext>>;
  employeeId: string;
  year: number;
  month: number;
}) {
  const { from, to } = getGridRange(year, month);
  const days = await getWorkforceDayInfoRange(ctx, employeeId, from, to);
  const byDate = new Map<string, WorkforceDayInfo>(days.map((d) => [d.date, d]));

  return <CalendarGrid from={from} to={to} year={year} month={month} byDate={byDate} today={todayIso()} />;
}
