import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { IncompleteAttendanceRow } from "@/domains/attendance/model";
import { AttendanceStatusBadge } from "../attendance-status-badge";
import { formatInstant } from "../format";

/** No fabricated checkout time and no client-computed "missing duration" — `record.workedMinutes`
 *  stays null for an INCOMPLETE day, and this table never fills that in. */
export function IncompleteAttendanceTable({ rows }: { rows: IncompleteAttendanceRow[] }) {
  if (rows.length === 0) {
    return <p className="px-1 py-4 text-sm text-slate-500">No incomplete attendance for this date.</p>;
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
          <TableHead>Work Date</TableHead>
          <TableHead>Status</TableHead>
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
            <TableCell>{formatInstant(row.record.firstCheckInAt, row.timezone, "—")}</TableCell>
            <TableCell>{row.scheduleName ?? "—"}</TableCell>
            <TableCell>{row.shiftName ?? "—"}</TableCell>
            <TableCell>{row.record.workDate}</TableCell>
            <TableCell>
              <AttendanceStatusBadge status={row.record.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
