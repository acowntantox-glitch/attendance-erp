import { getRequestContext } from "@/lib/auth/request-context";
import { Card, CardContent } from "@/components/ui/card";
import { OrgChartTree } from "@/components/employees/org-chart/org-chart-tree";
import { OrgChartSearch } from "@/components/employees/org-chart/org-chart-search";

export default async function OrgChartPage() {
  await getRequestContext();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Organization Chart</h1>
        <p className="text-sm text-slate-500">Expand a manager to load their direct reports.</p>
      </div>
      <OrgChartSearch />
      <Card>
        <CardContent>
          <OrgChartTree />
        </CardContent>
      </Card>
    </div>
  );
}
