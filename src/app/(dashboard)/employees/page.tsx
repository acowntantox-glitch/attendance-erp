import Link from "next/link";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { listEmployees } from "@/domains/employee/service";
import { listBranches, listDepartments, listDesignations } from "@/domains/organization/service";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { EmployeeFilterBar } from "@/components/employees/employee-filter-bar";
import { EmployeeDirectoryTable } from "@/components/employees/employee-directory-table";
import type { EmployeeListFilters } from "@/domains/employee/model";

type SearchParams = {
  page?: string;
  pageSize?: string;
  search?: string;
  departmentId?: string;
  designationId?: string;
  locationId?: string;
  status?: string;
  employmentType?: string;
  sort?: string;
};

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getRequestContext();
  const params = await searchParams;

  const filters: EmployeeListFilters = {
    page: Number(params.page ?? "1") || 1,
    pageSize: Number(params.pageSize ?? "25") || 25,
    search: params.search || undefined,
    departmentId: params.departmentId || undefined,
    designationId: params.designationId || undefined,
    locationId: params.locationId || undefined,
    status: (params.status as EmployeeListFilters["status"]) || undefined,
    employmentType: (params.employmentType as EmployeeListFilters["employmentType"]) || undefined,
    sort: (params.sort as EmployeeListFilters["sort"]) || undefined,
  };

  const [result, departments, designations, branches] = await Promise.all([
    listEmployees(ctx, filters),
    listDepartments(ctx),
    listDesignations(ctx),
    listBranches(ctx),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Employees</h1>
          <p className="text-sm text-slate-500">{result.total} employee{result.total === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/employees/org-chart">
            <Button variant="secondary">Org Chart</Button>
          </Link>
          {can(ctx.role, "employee.create") && (
            <Link href="/employees/new">
              <Button>Add Employee</Button>
            </Link>
          )}
        </div>
      </div>

      <EmployeeFilterBar
        basePath="/employees"
        defaults={params}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        designations={designations.map((d) => ({ id: d.id, name: d.name }))}
        locations={branches.map((b) => ({ id: b.id, name: b.name }))}
      />

      <EmployeeDirectoryTable employees={result.items} />
      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        basePath="/employees"
        searchParams={params}
      />
    </div>
  );
}
