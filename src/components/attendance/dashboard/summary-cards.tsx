import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttendanceDashboardSummary } from "@/domains/attendance/model";
import { STATUS_LABEL } from "../format";

/** Every count here is read directly off `AttendanceDashboardSummary`, itself a GROUP BY over
 *  `attendance_daily_records` — no counting of UI rows, no client-side aggregation. */
export function SummaryCards({ summary }: { summary: AttendanceDashboardSummary }) {
  const cards: { label: string; value: number }[] = [
    { label: "Total Employees", value: summary.totalEmployees },
    { label: STATUS_LABEL.PRESENT, value: summary.statusCounts.PRESENT },
    { label: STATUS_LABEL.LATE, value: summary.statusCounts.LATE },
    { label: STATUS_LABEL.INCOMPLETE, value: summary.statusCounts.INCOMPLETE },
    { label: STATUS_LABEL.ABSENT, value: summary.statusCounts.ABSENT },
    { label: STATUS_LABEL.WEEKLY_OFF, value: summary.statusCounts.WEEKLY_OFF },
    { label: STATUS_LABEL.HOLIDAY, value: summary.statusCounts.HOLIDAY },
    { label: STATUS_LABEL.WEEKLY_OFF_WORKED, value: summary.statusCounts.WEEKLY_OFF_WORKED },
    { label: STATUS_LABEL.HOLIDAY_WORKED, value: summary.statusCounts.HOLIDAY_WORKED },
    { label: STATUS_LABEL.NO_SCHEDULE, value: summary.statusCounts.NO_SCHEDULE },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-2xl font-semibold text-slate-900">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {summary.employeesWithoutRecord > 0 && (
        <p className="text-xs text-slate-400">
          {summary.employeesWithoutRecord} employee{summary.employeesWithoutRecord === 1 ? "" : "s"} have no attendance record computed for
          this date yet (no check-in, and their day hasn&apos;t been viewed) — not counted in any status above.
        </p>
      )}
    </div>
  );
}
