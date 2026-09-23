import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { getCompanyDefaultWeeklyOff } from "@/domains/workforce/service";
import { Card, CardContent } from "@/components/ui/card";
import { CompanyWeeklyOffPanel } from "@/components/workforce/company-weekly-off-panel";
import { WorkforceSubNav } from "@/components/workforce/workforce-subnav";

export default async function WeeklyOffsPage() {
  const ctx = await getRequestContext();
  const canView = can(ctx.role, "weekly_off.view");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Weekly Offs</h1>
        <p className="text-sm text-slate-500">
          The company-wide default off days. Individual employees can be given an override from their profile.
        </p>
      </div>

      <WorkforceSubNav role={ctx.role} />

      {!canView ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            You don&apos;t have permission to view weekly off settings.
          </CardContent>
        </Card>
      ) : (
        <CompanyWeeklyOffPanel rule={await getCompanyDefaultWeeklyOff(ctx)} canManage={can(ctx.role, "weekly_off.create")} />
      )}
    </div>
  );
}
