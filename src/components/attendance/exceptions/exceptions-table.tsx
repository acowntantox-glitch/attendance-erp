import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { AttendanceExceptionView } from "@/domains/attendance/exceptions/attendance-exception.service";
import { formatDateLabel, formatInstantWithDate, formatMinutesOrNull } from "../format";
import { DismissExceptionDialog } from "./dismiss-exception-dialog";
import { UndismissExceptionButton } from "./undismiss-exception-button";

const TYPE_LABEL: Record<AttendanceExceptionView["exceptionType"], string> = {
  LATE: "Late",
  INCOMPLETE: "Incomplete",
  ABSENT: "Absent",
  EARLY_DEPARTURE: "Early Departure",
};

/** Correctable only when the existing correction workflow actually has a path for it — a missing
 *  punch (INCOMPLETE/ABSENT). LATE/EARLY_DEPARTURE are facts about a punch that *was* recorded;
 *  correcting them means disputing the punch time itself, which the investigation page's own
 *  correction form already supports generically — this queue doesn't invent a second, narrower
 *  correction entry point for those, only a straight link to the day. */
function detailFor(row: AttendanceExceptionView): string {
  switch (row.exceptionType) {
    case "LATE":
      return `${formatMinutesOrNull(row.lateMinutes)} late`;
    case "EARLY_DEPARTURE":
      return `${formatMinutesOrNull(row.earlyDepartureMinutes)} early`;
    case "INCOMPLETE":
      return "Missing checkout";
    case "ABSENT":
      return "No attendance";
  }
}

export function ExceptionsTable({ items, timezone }: { items: AttendanceExceptionView[]; timezone: string }) {
  if (items.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-slate-500">No attendance exceptions in this view.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Exception</TableHead>
          <TableHead>Detail</TableHead>
          <TableHead>Period</TableHead>
          <TableHead>Status</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((row) => {
          const key = `${row.employeeId}-${row.workDate}-${row.exceptionType}`;
          const employeeName = `${row.firstName} ${row.lastName}`;
          const isDismissed = row.dismissal !== null;
          return (
            <TableRow key={key}>
              <TableCell className="font-medium text-slate-900">
                {employeeName}
                <div className="text-xs text-slate-400">{row.employeeNumber}</div>
              </TableCell>
              <TableCell>{formatDateLabel(row.workDate)}</TableCell>
              <TableCell>{TYPE_LABEL[row.exceptionType]}</TableCell>
              <TableCell>{detailFor(row)}</TableCell>
              <TableCell>
                {row.periodClosed ? <Badge variant="neutral">Closed</Badge> : <Badge variant="success">Open</Badge>}
              </TableCell>
              <TableCell>
                {isDismissed ? (
                  <div>
                    <Badge variant="neutral">Dismissed</Badge>
                    <div className="mt-1 text-xs text-slate-400">
                      {formatInstantWithDate(row.dismissal!.dismissedAt, timezone)}
                      {row.dismissal!.note && <div className="italic">&ldquo;{row.dismissal!.note}&rdquo;</div>}
                    </div>
                  </div>
                ) : (
                  <Badge variant="warning">Active</Badge>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Link href={`/employees/${row.employeeId}/attendance?date=${row.workDate}`} className="text-sm text-blue-700 hover:underline">
                    Investigate
                  </Link>
                  {(row.exceptionType === "INCOMPLETE" || row.exceptionType === "ABSENT") &&
                    !row.periodClosed && (
                      <Link
                        href={`/employees/${row.employeeId}/attendance?date=${row.workDate}`}
                        className="text-sm text-blue-700 hover:underline"
                      >
                        Request Correction
                      </Link>
                    )}
                  {isDismissed ? (
                    <UndismissExceptionButton employeeId={row.employeeId} workDate={row.workDate} exceptionType={row.exceptionType} />
                  ) : (
                    <DismissExceptionDialog employeeId={row.employeeId} workDate={row.workDate} exceptionType={row.exceptionType} employeeName={employeeName} />
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
