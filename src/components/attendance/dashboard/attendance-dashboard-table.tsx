import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AttendanceDashboardRow } from "@/domains/attendance/model";
import { AttendanceStatusBadge } from "../attendance-status-badge";
import { formatInstant, formatMinutesOrNull } from "../format";

/**
 * Every cell reads an existing backend value as-is. A row with `record: null` (no computed
 * attendance for this date — see `AttendanceDashboardSummary.employeesWithoutRecord`) shows "—"
 * throughout rather than any of the nine real statuses, since none of them actually apply.
 */
export function AttendanceDashboardTable({ rows }: { rows: AttendanceDashboardRow[] }) {
  if (rows.length === 0) {
    return <p className="px-1 py-10 text-center text-sm text-slate-500">No employees match these filters.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Employee #</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Schedule</TableHead>
            <TableHead>Shift</TableHead>
            <TableHead>Check In</TableHead>
            <TableHead>Check Out</TableHead>
            <TableHead>Scheduled</TableHead>
            <TableHead>Worked</TableHead>
            <TableHead>Break</TableHead>
            <TableHead>Late</TableHead>
            <TableHead>Early</TableHead>
            <TableHead>Overtime</TableHead>
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
              <TableCell>{row.record ? <AttendanceStatusBadge status={row.record.status} /> : <span className="text-slate-400">—</span>}</TableCell>
              <TableCell>{row.scheduleName ?? "—"}</TableCell>
              <TableCell>{row.shiftName ?? "—"}</TableCell>
              <TableCell>{row.record ? formatInstant(row.record.firstCheckInAt, row.timezone, "—") : "—"}</TableCell>
              <TableCell>{row.record ? formatInstant(row.record.lastCheckOutAt, row.timezone, "—") : "—"}</TableCell>
              <TableCell>{row.record ? formatMinutesOrNull(row.record.scheduledMinutes, "—") : "—"}</TableCell>
              <TableCell>{row.record ? formatMinutesOrNull(row.record.workedMinutes, "—") : "—"}</TableCell>
              <TableCell>{row.record ? formatMinutesOrNull(row.record.breakMinutes, "—") : "—"}</TableCell>
              <TableCell>{row.record ? formatMinutesOrNull(row.record.lateMinutes, "—") : "—"}</TableCell>
              <TableCell>{row.record ? formatMinutesOrNull(row.record.earlyDepartureMinutes, "—") : "—"}</TableCell>
              <TableCell>{row.record ? formatMinutesOrNull(row.record.overtimeMinutes, "—") : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
