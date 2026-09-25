import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AttendanceSessionView } from "@/domains/attendance/model";
import { formatInstant, formatMinutesOrNull, NOT_AVAILABLE } from "./format";

const SESSION_STATUS_VARIANT = {
  OPEN: "info",
  CLOSED: "success",
  ABANDONED: "danger",
} as const;

const SESSION_STATUS_LABEL = {
  OPEN: "Active",
  CLOSED: "Closed",
  ABANDONED: "Abandoned",
} as const;

function BreaksList({ breaks, timezone }: { breaks: AttendanceSessionView["breaks"]; timezone: string | null }) {
  if (breaks.length === 0) return <span className="text-slate-400">None</span>;
  return (
    <ul className="space-y-0.5">
      {breaks.map((b, i) => (
        <li key={b.startEventId ?? i}>
          {formatInstant(b.startAt, timezone)} – {b.endAt ? formatInstant(b.endAt, timezone) : <span className="text-blue-700">ongoing</span>}
          {b.endAt && <span className="ml-1 text-slate-400">({formatMinutesOrNull(Math.round((b.endAt.getTime() - b.startAt.getTime()) / 60000))})</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Multiple sessions per work date are expected, not an edge case (e.g. 09:00-12:00 then
 * 14:00-18:00) — every session captured for the day is listed individually. Duration is each
 * session's own `sessionWorkedMinutes`, computed server-side (see model.ts) — this table never
 * subtracts timestamps itself. `breaks` (Batch 9) is the same interval list `sessionBreakMinutes`
 * was already summed from — this table only ever displays it, never re-derives it from raw events.
 */
export function SessionsTable({ sessions }: { sessions: AttendanceSessionView[] }) {
  if (sessions.length === 0) {
    return <p className="px-1 text-sm text-slate-500">No attendance sessions recorded for this day.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Check In</TableHead>
          <TableHead>Check Out</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Breaks</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session.id}>
            <TableCell>{formatInstant(session.checkInAt, session.resolvedTimezone)}</TableCell>
            <TableCell>
              {session.checkOutAt ? (
                formatInstant(session.checkOutAt, session.resolvedTimezone)
              ) : (
                <span className="text-blue-700">Still active</span>
              )}
            </TableCell>
            <TableCell>{session.status === "OPEN" ? "In progress" : formatMinutesOrNull(session.sessionWorkedMinutes)}</TableCell>
            <TableCell>
              <BreaksList breaks={session.breaks} timezone={session.resolvedTimezone} />
            </TableCell>
            <TableCell>
              <Badge variant={SESSION_STATUS_VARIANT[session.status]}>{SESSION_STATUS_LABEL[session.status]}</Badge>
              {session.status === "ABANDONED" && (
                <span className="ml-2 text-xs text-slate-400">no check-out was ever recorded ({NOT_AVAILABLE.toLowerCase()})</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
