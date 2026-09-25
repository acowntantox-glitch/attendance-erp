import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AttendanceDayRecord } from "@/domains/attendance/model";
import { AttendanceStatusBadge } from "../attendance-status-badge";
import { formatMinutesOrNull } from "../format";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-800">{value}</dd>
    </div>
  );
}

/**
 * The one place this screen shows a status + the authoritative minute figures — all read directly
 * off `record` (real or the synthetic `UNPROCESSED` stand-in), never recomputed. Mirrors
 * `TodayAttendanceCard`'s established rendering rules for HOLIDAY/WEEKLY_OFF/NO_SCHEDULE/
 * INCOMPLETE/UNPROCESSED, generalized for an arbitrary historical date rather than "today."
 */
export function InvestigationSummaryCard({ record }: { record: AttendanceDayRecord }) {
  const isUnprocessed = record.status === "UNPROCESSED";
  const isDayOff = record.status === "HOLIDAY" || record.status === "WEEKLY_OFF";
  const isNoSchedule = record.status === "NO_SCHEDULE";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Attendance Summary</CardTitle>
        {isUnprocessed ? <Badge variant="neutral">Not Yet Processed</Badge> : <AttendanceStatusBadge status={record.status} />}
      </CardHeader>
      <CardContent className="space-y-4">
        {isUnprocessed && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
            This day has not been processed. Its attendance period is closed, so it will not be materialized as ABSENT or any other
            status until the period is reopened and it is explicitly processed or recalculated.
          </p>
        )}
        {isDayOff && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {record.status === "HOLIDAY" ? "This was a company holiday." : "This was a weekly off day."}
          </p>
        )}
        {isNoSchedule && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
            No work schedule was assigned for this date, so there is no expectation to compare worked time against.
          </p>
        )}
        {record.status === "INCOMPLETE" && (
          <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            At least one session on this day has no check-out. Worked/overtime figures are pending until it&apos;s closed — never
            fabricated as a completed duration.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Scheduled" value={formatMinutesOrNull(record.scheduledMinutes)} />
          <Stat label="Worked" value={formatMinutesOrNull(record.workedMinutes)} />
          <Stat label="Late" value={formatMinutesOrNull(record.lateMinutes)} />
          <Stat label="Early Departure" value={formatMinutesOrNull(record.earlyDepartureMinutes)} />
          <Stat label="Overtime" value={formatMinutesOrNull(record.overtimeMinutes)} />
          <Stat label="Break" value={formatMinutesOrNull(record.breakMinutes)} />
        </dl>
      </CardContent>
    </Card>
  );
}
