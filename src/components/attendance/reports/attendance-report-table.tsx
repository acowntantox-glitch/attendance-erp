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
    return <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">No attendance records found.</p>
      <p className="mt-1 text-xs text-slate-500">Try a different date range or clear the filters.</p>
    </div>;
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
            <TableCell className="tabular-nums">{formatMinutesOrNull(row.scheduledMinutes, "—")}</TableCell>
            <TableCell className="tabular-nums">{formatMinutesOrNull(row.workedMinutes, "—")}</TableCell>
            <TableCell className="tabular-nums">{formatMinutesOrNull(row.lateMinutes, "—")}</TableCell>
            <TableCell className="tabular-nums">{formatMinutesOrNull(row.earlyDepartureMinutes, "—")}</TableCell>
            <TableCell className="tabular-nums">{formatMinutesOrNull(row.overtimeMinutes, "—")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
