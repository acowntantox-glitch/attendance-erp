import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AttendanceReportRow } from "@/domains/attendance/reports/attendance-report.repository";
import { AttendanceStatusBadge } from "../attendance-status-badge";
import { formatDateLabel, formatMinutesOrNull } from "../format";

/** Every column is a value already stored on `attendance_daily_records` (via the report row) —
 *  nothing here recomputes worked/late/overtime minutes. Dense table, so nulls (an INCOMPLETE
 *  day's unknown values) render as "—", matching the existing convention used by
 *  `IncompleteAttendanceTable`/`LateArrivalsTable`. */
export function AttendanceReportTable({ rows }: { rows: AttendanceReportRow[] }) {
  if (rows.length === 0) {
    return <p className="px-1 py-4 text-sm text-slate-500">No attendance records found for the selected filters.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Employee #</TableHead>
          <TableHead>Department</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Scheduled</TableHead>
          <TableHead>Worked</TableHead>
          <TableHead>Late</TableHead>
          <TableHead>Early Leave</TableHead>
          <TableHead>Overtime</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.employeeId}-${row.workDate}`}>
            <TableCell className="font-medium text-slate-900">
              {row.firstName} {row.lastName}
            </TableCell>
            <TableCell className="font-mono text-xs">{row.employeeNumber}</TableCell>
            <TableCell>{row.departmentName ?? "—"}</TableCell>
            <TableCell>{row.locationName ?? "—"}</TableCell>
            <TableCell>{formatDateLabel(row.workDate)}</TableCell>
            <TableCell>
              <AttendanceStatusBadge status={row.status} />
            </TableCell>
            <TableCell>{formatMinutesOrNull(row.scheduledMinutes, "—")}</TableCell>
            <TableCell>{formatMinutesOrNull(row.workedMinutes, "—")}</TableCell>
            <TableCell>{formatMinutesOrNull(row.lateMinutes, "—")}</TableCell>
            <TableCell>{formatMinutesOrNull(row.earlyDepartureMinutes, "—")}</TableCell>
            <TableCell>{formatMinutesOrNull(row.overtimeMinutes, "—")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
