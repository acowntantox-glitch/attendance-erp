import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { listHolidays } from "@/domains/workforce/service";
import { listBranches } from "@/domains/organization/service";
import { addDays } from "@/lib/datetime";
import { Card, CardContent } from "@/components/ui/card";
import { HolidaysPanel } from "@/components/workforce/holidays-panel";
import { WorkforceSubNav } from "@/components/workforce/workforce-subnav";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function HolidaysPage() {
  const ctx = await getRequestContext();
  const canView = can(ctx.role, "holiday.view");

  // A generous window (1 year back, 2 years forward) rather than an unbounded list — holidays
  // are a date-range resource, listHolidays requires from/to per the existing API contract.
  const from = addDays(todayIso(), -365);
  const to = addDays(todayIso(), 730);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Holidays</h1>
        <p className="text-sm text-slate-500">Company-wide and branch-specific holidays the workforce calendar observes.</p>
      </div>

      <WorkforceSubNav role={ctx.role} />

      {!canView ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">You don&apos;t have permission to view holidays.</CardContent>
        </Card>
      ) : (
        <HolidaysPanel
          holidays={await listHolidays(ctx, from, to)}
          branches={(await listBranches(ctx)).map((b) => ({ id: b.id, name: b.name }))}
          canCreate={can(ctx.role, "holiday.create")}
          canUpdate={can(ctx.role, "holiday.update")}
          canArchive={can(ctx.role, "holiday.archive")}
        />
      )}
    </div>
  );
}
