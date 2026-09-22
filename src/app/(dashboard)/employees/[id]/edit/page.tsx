import { notFound, redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { getEmployee, listEmployees } from "@/domains/employee/service";
import { EmployeeNotFoundError } from "@/domains/employee/errors";
import { listBranches, listDepartments, listDesignations } from "@/domains/organization/service";
import { EmployeeForm, type EmployeeFormValues } from "@/components/employees/employee-form";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext();
  if (!can(ctx.role, "employee.update")) {
    redirect("/employees");
  }
  const { id } = await params;

  let employee;
  try {
    employee = await getEmployee(ctx, id);
  } catch (error) {
    if (error instanceof EmployeeNotFoundError) notFound();
    throw error;
  }

  const [departments, designations, branches, managerCandidates] = await Promise.all([
    listDepartments(ctx),
    listDesignations(ctx),
    listBranches(ctx),
    listEmployees(ctx, { page: 1, pageSize: 200, sort: "name_asc" }),
  ]);

  const initialValues: Partial<EmployeeFormValues> = {
    firstName: employee.firstName,
    middleName: employee.middleName ?? "",
    lastName: employee.lastName,
    preferredName: employee.preferredName ?? "",
    dateOfBirth: employee.dateOfBirth ?? "",
    gender: employee.gender ?? "",
    nationality: employee.nationality ?? "",
    personalEmail: employee.personalEmail ?? "",
    workEmail: employee.workEmail,
    phone: employee.phone ?? "",
    alternatePhone: employee.alternatePhone ?? "",
    address: employee.address ?? "",
    city: employee.city ?? "",
    state: employee.state ?? "",
    country: employee.country ?? "",
    postalCode: employee.postalCode ?? "",
    departmentId: employee.departmentId ?? "",
    designationId: employee.designationId ?? "",
    locationId: employee.locationId ?? "",
    managerId: employee.managerId ?? "",
    employmentType: employee.employmentType,
    dateOfJoining: employee.dateOfJoining,
    probationEndDate: employee.probationEndDate ?? "",
    emergencyContactName: employee.emergencyContactName ?? "",
    emergencyContactPhone: employee.emergencyContactPhone ?? "",
    emergencyContactRelationship: employee.emergencyContactRelationship ?? "",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          Edit {employee.firstName} {employee.lastName}
        </h1>
        <p className="text-sm text-slate-500">{employee.employeeNumber}</p>
      </div>
      <EmployeeForm
        mode="edit"
        employeeId={employee.id}
        initialValues={initialValues}
        departments={departments.filter((d) => d.isActive).map((d) => ({ id: d.id, name: d.name }))}
        designations={designations.filter((d) => d.isActive).map((d) => ({ id: d.id, name: d.name }))}
        locations={branches.filter((b) => b.isActive).map((b) => ({ id: b.id, name: b.name }))}
        managers={managerCandidates.items
          .filter((e) => e.id !== employee.id)
          .map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }))}
      />
    </div>
  );
}
