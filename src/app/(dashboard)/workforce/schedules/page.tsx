import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { listWorkSchedules } from "@/domains/workforce/service";
import { Card, CardContent } from "@/components/ui/card";
import { WorkSchedulesPanel } from "@/components/workforce/work-schedules-panel";
import { WorkforceSubNav } from "@/components/workforce/workforce-subnav";

export default async function WorkSchedulesPage() {
  const ctx = await getRequestContext();
  const canView = can(ctx.role, "schedule.view");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Work Schedules</h1>
        <p className="text-sm text-slate-500">Reusable daily-hours templates employees are assigned to.</p>
      </div>

      <WorkforceSubNav role={ctx.role} />

      {!canView ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            You don&apos;t have permission to view work schedules.
          </CardContent>
        </Card>
      ) : (
        <WorkSchedulesPanel
          schedules={await listWorkSchedules(ctx)}
          canCreate={can(ctx.role, "schedule.create")}
          canUpdate={can(ctx.role, "schedule.update")}
          canArchive={can(ctx.role, "schedule.archive")}
        />
      )}
    </div>
  );
}
