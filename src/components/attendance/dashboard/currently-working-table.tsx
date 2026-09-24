import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CurrentlyWorkingRow } from "@/domains/attendance/model";
import { formatInstant } from "../format";

/** Session/break state read straight from the backend (`hasOpenBreak`) — this table never derives
 *  "on break" from raw events itself. */
export function CurrentlyWorkingTable({ rows }: { rows: CurrentlyWorkingRow[] }) {
  if (rows.length === 0) {
    return <p className="px-1 py-4 text-sm text-slate-500">No employees are currently checked in.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Employee #</TableHead>
          <TableHead>Department</TableHead>
          <TableHead>Check In</TableHead>
          <TableHead>Schedule</TableHead>
          <TableHead>Shift</TableHead>
          <TableHead>State</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link href={`/employees/${row.id}/attendance`} className="font-medium text-blue-700 hover:underline">
                {row.firstName} {row.lastName}
              </Link>
            </TableCell>
            <TableCell className="font-mono text-xs">{row.employeeNumber}</TableCell>
            <TableCell>{row.department?.name ?? "—"}</TableCell>
            <TableCell>{formatInstant(row.session.checkInAt, row.session.resolvedTimezone, "—")}</TableCell>
            <TableCell>{row.session.expectedWorkSchedule?.name ?? "—"}</TableCell>
            <TableCell>{row.session.expectedShift?.name ?? "—"}</TableCell>
            <TableCell>
              <Badge variant={row.hasOpenBreak ? "warning" : "success"}>{row.hasOpenBreak ? "On Break" : "Working"}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
