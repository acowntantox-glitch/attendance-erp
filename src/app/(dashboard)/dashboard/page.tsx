import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { listBranches, listDepartments } from "@/domains/organization/service";
import { getEmployeeCounts } from "@/domains/employee/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const ctx = await getRequestContext();
  const canViewEmployees = can(ctx.role, "employee.view");
  const canViewDepartments = can(ctx.role, "department.view");
  const canViewLocations = can(ctx.role, "location.view");

  // Every number here comes from a real query against the current company's data — no
  // hard-coded placeholders (spec §28). Each widget is skipped entirely for roles without the
  // underlying permission (e.g. a plain EMPLOYEE) rather than throwing an AuthorizationError on
  // their own dashboard — found via live testing with the seeded EMPLOYEE-role account, which
  // has none of employee.view/department.view/location.view.
  const [branches, departments, employeeCounts] = await Promise.all([
    canViewLocations ? listBranches(ctx) : Promise.resolve(null),
    canViewDepartments ? listDepartments(ctx) : Promise.resolve(null),
    canViewEmployees ? getEmployeeCounts(ctx) : Promise.resolve(null),
  ]);

  const stats = [
    ...(employeeCounts
      ? [
          { label: "Total Employees", value: employeeCounts.totalEmployees },
          { label: "Active Employees", value: employeeCounts.activeEmployees },
          { label: "On Probation", value: employeeCounts.onProbation },
          { label: "On Notice Period", value: employeeCounts.onNoticePeriod },
          { label: "New Joiners (This Month)", value: employeeCounts.newJoinersThisMonth },
        ]
      : []),
    ...(departments ? [{ label: "Departments", value: departments.length }] : []),
    ...(branches ? [{ label: "Locations", value: branches.length }] : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500">Overview of your organization. Attendance metrics arrive in a later phase.</p>
      </div>
      {stats.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            Nothing to show here yet for your role.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
      )}
    </div>
  );
}
