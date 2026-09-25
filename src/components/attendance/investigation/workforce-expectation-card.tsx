import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { WorkforceDayInfo } from "@/domains/workforce/model";

/**
 * "What schedule/workforce expectation applied" — read entirely off `getWorkforceDayInfo`, the
 * Workforce domain's own authority (see Phase 5's source-of-truth map). Deliberately shows no
 * minutes figure of its own: `record.scheduledMinutes` (Attendance Summary, below) is the one
 * authoritative scheduled-minutes number — duplicating it here risks two figures silently
 * disagreeing (e.g. on an UNPROCESSED day, where `record.scheduledMinutes` is a placeholder 0).
 */
export function WorkforceExpectationCard({ dayInfo }: { dayInfo: WorkforceDayInfo }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workforce Expectation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {dayInfo.isHoliday && <Badge variant="neutral">Holiday{dayInfo.holiday ? `: ${dayInfo.holiday.name}` : ""}</Badge>}
          {dayInfo.isWeeklyOff && <Badge variant="neutral">Weekly Off</Badge>}
          {!dayInfo.isHoliday && !dayInfo.isWeeklyOff && (
            <Badge variant={dayInfo.isWorkingDay ? "info" : "neutral"}>{dayInfo.isWorkingDay ? "Working Day" : "Not a Working Day"}</Badge>
          )}
        </div>

        {dayInfo.scheduleAssignment ? (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Schedule</dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-800">{dayInfo.scheduleAssignment.workSchedule.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Shift</dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-800">{dayInfo.scheduleAssignment.shift?.name ?? "Schedule default hours"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Expected</dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-800">
                {dayInfo.expectedWindow ? (
                  <>
                    {dayInfo.expectedWindow.start.time} → {dayInfo.expectedWindow.end.time}
                    {dayInfo.expectedWindow.spansMidnight && <span className="ml-1 text-xs text-slate-400">(overnight)</span>}
                  </>
                ) : (
                  "Not available"
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-slate-500">No work schedule is assigned for this date.</p>
        )}
      </CardContent>
    </Card>
  );
}
