import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { listShifts } from "@/domains/workforce/service";
import { Card, CardContent } from "@/components/ui/card";
import { ShiftsPanel } from "@/components/workforce/shifts-panel";
import { WorkforceSubNav } from "@/components/workforce/workforce-subnav";

export default async function ShiftsPage() {
  const ctx = await getRequestContext();
  const canView = can(ctx.role, "shift.view");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Shifts</h1>
        <p className="text-sm text-slate-500">Named hour blocks that can override a schedule&apos;s default hours per employee.</p>
      </div>

      <WorkforceSubNav role={ctx.role} />

      {!canView ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">You don&apos;t have permission to view shifts.</CardContent>
        </Card>
      ) : (
        <ShiftsPanel
          shifts={await listShifts(ctx)}
          canCreate={can(ctx.role, "shift.create")}
          canUpdate={can(ctx.role, "shift.update")}
          canArchive={can(ctx.role, "shift.archive")}
        />
      )}
    </div>
  );
}
