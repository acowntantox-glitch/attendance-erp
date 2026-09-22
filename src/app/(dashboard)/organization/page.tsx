import { getRequestContext } from "@/lib/auth/request-context";
import { getMyCompany, listBranches, listDepartments, listLocations } from "@/domains/organization/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function OrganizationPage() {
  const ctx = await getRequestContext();
  const [company, branches, departments, locations] = await Promise.all([
    getMyCompany(ctx),
    listBranches(ctx),
    listDepartments(ctx),
    listLocations(ctx),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Organization</h1>
        <p className="text-sm text-slate-500">
          {company.name} · {company.code} · {company.timezone}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Branches ({branches.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {branches.length === 0 ? (
            <p className="text-sm text-slate-500">No branches yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {branches.map((branch) => (
                <li key={branch.id} className="py-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">{branch.name}</span>{" "}
                  <span className="text-slate-400">({branch.code})</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Departments ({departments.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {departments.length === 0 ? (
            <p className="text-sm text-slate-500">No departments yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {departments.map((department) => (
                <li key={department.id} className="py-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">{department.name}</span>{" "}
                  <span className="text-slate-400">({department.code})</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Locations ({locations.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {locations.length === 0 ? (
            <p className="text-sm text-slate-500">No locations yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {locations.map((location) => (
                <li key={location.id} className="py-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">{location.name}</span>{" "}
                  <span className="text-slate-400">
                    ({location.latitude}, {location.longitude})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
