import { getRequestContext } from "@/lib/auth/request-context";
import { listBranches, listDepartments, listLocations } from "@/domains/organization/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const ctx = await getRequestContext();
  const [branches, departments, locations] = await Promise.all([
    listBranches(ctx),
    listDepartments(ctx),
    listLocations(ctx),
  ]);

  const stats = [
    { label: "Branches", value: branches.length },
    { label: "Departments", value: departments.length },
    { label: "Locations", value: locations.length },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500">Overview of your organization. Attendance metrics arrive in a later phase.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardTitle>{stat.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-slate-900">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
