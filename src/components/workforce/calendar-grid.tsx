import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { buildWeeks, isInMonth } from "./calendar-month";
import { formatTime } from "./format";
import type { WorkforceDayInfo } from "@/domains/workforce/model";

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function DayCell({ date, info, inMonth, isToday }: { date: string; info: WorkforceDayInfo | undefined; inMonth: boolean; isToday: boolean }) {
  const dayNumber = Number(date.slice(-2));

  return (
    <div
      className={cn(
        "min-h-[6.5rem] rounded-md border p-2 text-xs",
        inMonth ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 text-slate-400",
        isToday && "ring-2 ring-blue-600",
      )}
    >
      <div className={cn("mb-1 text-right text-sm font-medium", inMonth ? "text-slate-700" : "text-slate-300")}>{dayNumber}</div>

      {!info ? null : info.isHoliday ? (
        <div className="space-y-1">
          <Badge variant="danger">Holiday</Badge>
          <p className="truncate font-medium text-slate-700" title={info.holiday?.name}>
            {info.holiday?.name}
          </p>
          {info.holiday && <p className="text-slate-400">{info.holiday.holidayType.replaceAll("_", " ")}</p>}
        </div>
      ) : info.isWeeklyOff ? (
        <Badge variant="warning">Weekly Off</Badge>
      ) : info.isWorkingDay && info.expectedWindow ? (
        <div className="space-y-1">
          <Badge variant="success">Scheduled</Badge>
          <p className="text-slate-600">
            {formatTime(info.expectedWindow.start.time)} – {formatTime(info.expectedWindow.end.time)}
          </p>
          {info.expectedWindow.spansMidnight && <Badge variant="info">Overnight</Badge>}
          {info.scheduleAssignment?.shift && (
            <p className="truncate text-slate-400" title={info.scheduleAssignment.shift.name}>
              {info.scheduleAssignment.shift.name}
            </p>
          )}
        </div>
      ) : info.isWorkingDay ? (
        <Badge variant="neutral">No Assignment</Badge>
      ) : null}
    </div>
  );
}

export function CalendarGrid({
  from,
  to,
  year,
  month,
  byDate,
  today,
}: {
  from: string;
  to: string;
  year: number;
  month: number;
  byDate: Map<string, WorkforceDayInfo>;
  today: string;
}) {
  const weeks = buildWeeks(from, to);

  return (
    <div role="table" aria-label="Workforce calendar" className="space-y-2">
      <div role="row" className="grid grid-cols-7 gap-2">
        {WEEKDAY_HEADERS.map((label) => (
          <div key={label} role="columnheader" className="text-center text-xs font-semibold uppercase tracking-wide text-slate-400">
            {label}
          </div>
        ))}
      </div>

      {weeks.map((week) => (
        <div key={week[0]} role="row" className="grid grid-cols-7 gap-2">
          {week.map((date) => (
            <div key={date} role="cell">
              <DayCell date={date} info={byDate.get(date)} inMonth={isInMonth(date, year, month)} isToday={date === today} />
            </div>
          ))}
        </div>
      ))}

      <div className="flex flex-wrap gap-3 pt-2 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Badge variant="success">Scheduled</Badge> Working, with a schedule
        </span>
        <span className="flex items-center gap-1">
          <Badge variant="warning">Weekly Off</Badge> Off per weekly-off rule
        </span>
        <span className="flex items-center gap-1">
          <Badge variant="danger">Holiday</Badge> Company or branch holiday
        </span>
        <span className="flex items-center gap-1">
          <Badge variant="neutral">No Assignment</Badge> Working day, nothing scheduled
        </span>
      </div>
    </div>
  );
}
