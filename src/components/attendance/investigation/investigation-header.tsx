import type { EmployeeWithRelations } from "@/domains/employee/model";

/** Every field here comes straight off `getEmployee`'s existing result — nothing computed. */
export function InvestigationHeader({ employee }: { employee: EmployeeWithRelations }) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Employee</dt>
        <dd className="mt-0.5 text-sm font-medium text-slate-900">
          {employee.firstName} {employee.lastName}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Employee No.</dt>
        <dd className="mt-0.5 text-sm font-medium text-slate-800">{employee.employeeNumber}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Department</dt>
        <dd className="mt-0.5 text-sm font-medium text-slate-800">{employee.department?.name ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Designation</dt>
        <dd className="mt-0.5 text-sm font-medium text-slate-800">{employee.designation?.name ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Location</dt>
        <dd className="mt-0.5 text-sm font-medium text-slate-800">{employee.location?.name ?? "—"}</dd>
      </div>
    </dl>
  );
}
