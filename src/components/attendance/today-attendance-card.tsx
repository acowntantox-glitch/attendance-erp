import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AttendanceDayRecord, AttendanceSessionView } from "@/domains/attendance/model";
import { AttendanceStatusBadge } from "./attendance-status-badge";
import { formatDateLabel, formatInstant, formatMinutesOrNull } from "./format";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-800">{value}</dd>
    </div>
  );
}

/**
 * Every value here is either read directly off `record` (the backend's authoritative daily
 * calculation) or off `referenceSession` (the first session that captured today's Workforce
 * snapshot, for display only). Nothing is computed, summed, or re-derived in this component.
 */
export function TodayAttendanceCard({
  workDate,
  record,
  referenceSession,
}: {
  workDate: string;
  record: AttendanceDayRecord;
  referenceSession: AttendanceSessionView | null;
}) {
  const isUnprocessed = record.status === "UNPROCESSED";
  const isDayOff = record.status === "HOLIDAY" || record.status === "WEEKLY_OFF";
  const isNoSchedule = record.status === "NO_SCHEDULE";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{formatDateLabel(workDate)}</CardTitle>
        {isUnprocessed ? <Badge variant="neutral">Not Yet Processed</Badge> : <AttendanceStatusBadge status={record.status} />}
      </CardHeader>
      <CardContent className="space-y-5">
        {isUnprocessed && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
            This month&apos;s attendance period is closed and this day was never processed, so no totals are available. Reopen the
            period first if this needs to be computed.
          </p>
        )}
        {isDayOff && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {record.status === "HOLIDAY" ? "This is a company holiday." : "This is a weekly off day."} Checking in is still allowed if
            you worked.
          </p>
        )}
        {isNoSchedule && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
            No work schedule is currently assigned. Check-in is still available — worked time is recorded, but there is no schedule to
            compare it against.
          </p>
        )}
        {!referenceSession && record.sessionCount === 0 && !isDayOff && !isNoSchedule && !isUnprocessed && (
          <p className="text-sm text-slate-500">Not checked in yet today.</p>
        )}

        {referenceSession?.expectedWorkSchedule && (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Schedule" value={referenceSession.expectedWorkSchedule.name} />
            <Stat label="Shift" value={referenceSession.expectedShift?.name ?? "Schedule default hours"} />
            <Stat
              label="Expected"
              value={
                referenceSession.expectedStartAt && referenceSession.expectedEndAt
                  ? `${formatInstant(referenceSession.expectedStartAt, referenceSession.resolvedTimezone)} – ${formatInstant(
                      referenceSession.expectedEndAt,
                      referenceSession.resolvedTimezone,
                    )}`
                  : "Not available"
              }
            />
            <Stat label="Timezone" value={referenceSession.resolvedTimezone ?? "Not available"} />
          </dl>
        )}

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Scheduled" value={formatMinutesOrNull(record.scheduledMinutes)} />
          <Stat label="Worked" value={formatMinutesOrNull(record.workedMinutes)} />
          <Stat label="Break" value={formatMinutesOrNull(record.breakMinutes)} />
          <Stat label="Late" value={formatMinutesOrNull(record.lateMinutes)} />
          <Stat label="Early Departure" value={formatMinutesOrNull(record.earlyDepartureMinutes)} />
          <Stat label="Overtime" value={formatMinutesOrNull(record.overtimeMinutes)} />
        </dl>

        {record.status === "INCOMPLETE" && (
          <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            A previous session on this day has no check-out yet. Worked/overtime figures are pending until it&apos;s closed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
