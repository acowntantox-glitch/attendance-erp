import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { listEmployees } from "@/domains/employee/service";
import { listBranches, listDepartments, listDesignations } from "@/domains/organization/service";
import { EmployeeForm } from "@/components/employees/employee-form";

export default async function NewEmployeePage() {
  const ctx = await getRequestContext();
  if (!can(ctx.role, "employee.create")) {
    redirect("/employees");
  }

  const [departments, designations, branches, managerCandidates] = await Promise.all([
    listDepartments(ctx),
    listDesignations(ctx),
    listBranches(ctx),
    listEmployees(ctx, { page: 1, pageSize: 200, sort: "name_asc" }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Add Employee</h1>
        <p className="text-sm text-slate-500">Create a new employee record for this company.</p>
      </div>
      <EmployeeForm
        mode="create"
        departments={departments.filter((d) => d.isActive).map((d) => ({ id: d.id, name: d.name }))}
        designations={designations.filter((d) => d.isActive).map((d) => ({ id: d.id, name: d.name }))}
        locations={branches.filter((b) => b.isActive).map((b) => ({ id: b.id, name: b.name }))}
        managers={managerCandidates.items.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }))}
      />
    </div>
  );
}
