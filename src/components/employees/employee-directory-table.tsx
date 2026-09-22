import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmployeeStatusBadge } from "./employee-status-badge";
import type { EmployeeWithRelations } from "@/domains/employee/model";

export function EmployeeDirectoryTable({ employees }: { employees: EmployeeWithRelations[] }) {
  if (employees.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
        No employees match these filters.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Employee #</TableHead>
          <TableHead>Department</TableHead>
          <TableHead>Designation</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Manager</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Joined</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {employees.map((employee) => (
          <TableRow key={employee.id}>
            <TableCell>
              <Link href={`/employees/${employee.id}`} className="font-medium text-blue-700 hover:underline">
                {employee.firstName} {employee.lastName}
              </Link>
              <div className="text-xs text-slate-400">{employee.workEmail}</div>
            </TableCell>
            <TableCell className="font-mono text-xs">{employee.employeeNumber}</TableCell>
            <TableCell>{employee.department?.name ?? "—"}</TableCell>
            <TableCell>{employee.designation?.name ?? "—"}</TableCell>
            <TableCell>{employee.location?.name ?? "—"}</TableCell>
            <TableCell>
              {employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : "—"}
            </TableCell>
            <TableCell>{employee.employmentType.replaceAll("_", " ")}</TableCell>
            <TableCell>
              <EmployeeStatusBadge status={employee.employmentStatus} />
            </TableCell>
            <TableCell>{employee.dateOfJoining}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
