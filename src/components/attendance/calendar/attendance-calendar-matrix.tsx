import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AttendanceCalendarCell, AttendanceCalendarResult } from "@/domains/attendance/calendar/attendance-calendar.service";
import type { AttendanceDailyStatus } from "@/domains/attendance/model";
import { STATUS_LABEL, STATUS_SHORT_LABEL, formatMinutesOrNull, formatWeekdayShort, isWeekendDate } from "../format";
import { cn } from "@/lib/utils";

const UNPROCESSED_SHORT = "—";

/** Every status has a visible short code AND a full-word tooltip/aria-label — never color alone
 *  (§31). `hasRecord` (not the status) gates click-ability, so an Unprocessed/future cell — which
 *  has no real `attendance_daily_records` row — never links anywhere that would imply an
 *  attendance event exists for it (§13/§19). */
function CalendarCellView({
  cell,
  employeeId,
  employeeName,
  today,
}: {
  cell: AttendanceCalendarCell;
  employeeId: string;
  employeeName: string;
  today: string;
}) {
  const isFuture = cell.date > today;
  const shortLabel = cell.status === "UNPROCESSED" ? UNPROCESSED_SHORT : STATUS_SHORT_LABEL[cell.status as AttendanceDailyStatus];
  const statusWord = cell.status === "UNPROCESSED" ? (isFuture ? "Future date — not yet processed" : "Unprocessed") : STATUS_LABEL[cell.status as AttendanceDailyStatus];
  const workedPart = cell.hasRecord && cell.workedMinutes !== null ? ` — ${formatMinutesOrNull(cell.workedMinutes)} worked` : "";
  const accessibleLabel = `${employeeName} — ${cell.date} — ${statusWord}${workedPart}`;

  // Labeled on exactly one element — the outer interactive one when there is a real record to
  // link to, otherwise the span itself — never both, which would double-announce the same name
  // to assistive tech.
  const badgeClassName = cn(
    "flex h-8 w-10 items-center justify-center rounded text-xs font-medium",
    cell.status === "UNPROCESSED" ? "text-slate-300" : "text-slate-700",
    cell.status === "ABSENT" && "bg-red-50 text-red-700",
    cell.status === "LATE" && "bg-amber-50 text-amber-700",
    (cell.status === "PRESENT" || cell.status === "WEEKLY_OFF_WORKED" || cell.status === "HOLIDAY_WORKED") && "bg-green-50 text-green-700",
    cell.status === "INCOMPLETE" && "bg-amber-50 text-amber-700",
  );

  if (!cell.hasRecord) {
    return (
      <span title={accessibleLabel} aria-label={accessibleLabel} className={badgeClassName}>
        {shortLabel}
      </span>
    );
  }

  return (
    <Link
      href={`/employees/${employeeId}/attendance?date=${cell.date}`}
      title={accessibleLabel}
      aria-label={accessibleLabel}
      className="inline-block"
    >
      <span className={badgeClassName} aria-hidden="true">
        {shortLabel}
      </span>
    </Link>
  );
}

/** Non-zero status counts only, joined compactly — the full breakdown (including zeros) is
 *  always available in the `title` tooltip (§15/§16 — "avoid trying to put too much text into the
 *  grid... a tooltip for full details"). */
function compactCounts(counts: Record<AttendanceDailyStatus, number>): { compact: string; full: string } {
  const entries = (Object.keys(counts) as AttendanceDailyStatus[]).map((status) => ({ status, value: counts[status] }));
  const nonZero = entries.filter((e) => e.value > 0);
  const compact = nonZero.length > 0 ? nonZero.map((e) => `${STATUS_SHORT_LABEL[e.status]}:${e.value}`).join(" ") : "—";
  const full = entries.map((e) => `${STATUS_LABEL[e.status]}: ${e.value}`).join(", ");
  return { compact, full };
}

export function AttendanceCalendarMatrix({ result, today }: { result: AttendanceCalendarResult; today: string }) {
  if (result.rows.length === 0) {
    return <p className="px-1 py-4 text-sm text-slate-500">No employees found for the selected filters.</p>;
  }

  const noRecordsAtAll = result.summary.processedEmployeeDays === 0;

  return (
    <div className="space-y-2">
      {noRecordsAtAll && (
        <p className="px-1 text-sm text-slate-500">
          No attendance has been processed for this period yet. Run Process Day from the Attendance Dashboard.
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-slate-50">Employee</TableHead>
            {result.days.map((date) => {
              const dayNumber = date.slice(8, 10);
              const weekend = isWeekendDate(date);
              return (
                <TableHead key={date} className={cn("text-center", weekend && "bg-slate-100")}>
                  <div>{dayNumber}</div>
                  <div className="text-[10px] font-normal text-slate-400">{formatWeekdayShort(date)}</div>
                </TableHead>
              );
            })}
            <TableHead className="text-center">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((row) => {
            const employeeName = `${row.firstName} ${row.lastName}`;
            const rowTotals = compactCounts(row.totals);
            return (
              <TableRow key={row.employeeId}>
                <TableCell className="sticky left-0 z-10 bg-white font-medium text-slate-900">
                  <Link href={`/employees/${row.employeeId}/attendance`} className="text-blue-700 hover:underline">
                    {employeeName}
                  </Link>
                  <div className="text-xs text-slate-400">{row.employeeNumber}</div>
                </TableCell>
                {row.cells.map((cell) => (
                  <TableCell key={cell.date} className="text-center">
                    <CalendarCellView cell={cell} employeeId={row.employeeId} employeeName={employeeName} today={today} />
                  </TableCell>
                ))}
                <TableCell className="text-center text-xs" title={rowTotals.full}>
                  {rowTotals.compact}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <tfoot>
          <TableRow>
            <TableCell className="sticky left-0 z-10 bg-slate-50 font-medium text-slate-700">Daily Total</TableCell>
            {result.dailyTotals.map((daily) => {
              const { compact, full } = compactCounts(daily.statusCounts);
              return (
                <TableCell key={daily.date} className="text-center text-xs" title={full}>
                  {compact}
                </TableCell>
              );
            })}
            <TableCell />
          </TableRow>
        </tfoot>
      </Table>
    </div>
  );
}
