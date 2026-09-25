import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttendanceEvent } from "@/domains/attendance/model";
import { formatInstant } from "../format";

const EVENT_LABEL: Record<AttendanceEvent["eventType"], string> = {
  CHECK_IN: "Check In",
  BREAK_START: "Break Start",
  BREAK_END: "Break End",
  CHECK_OUT: "Check Out",
};

/**
 * The raw immutable `attendance_events` stream for this work date, already ordered
 * chronologically by `attendanceEventRepository.listForEmployeeWorkDate` — displayed exactly as
 * stored. This is a read of the event log, not a second attendance calculation: it never groups
 * events into sessions or derives a duration itself (that's `SessionsTable`'s job, from data the
 * backend already computed).
 */
export function EventTimeline({ events, timezone }: { events: AttendanceEvent[]; timezone: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Event Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-slate-500">No attendance events recorded for this day.</p>
        ) : (
          <ol className="space-y-2">
            {events.map((event) => (
              <li key={event.id} className="flex items-baseline gap-3 text-sm">
                <span className="w-20 shrink-0 font-mono text-slate-500">{formatInstant(event.occurredAt, timezone)}</span>
                <span className="font-medium text-slate-800">{EVENT_LABEL[event.eventType]}</span>
                <span className="text-xs text-slate-400">{event.source}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
