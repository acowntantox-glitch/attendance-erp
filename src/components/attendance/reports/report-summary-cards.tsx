import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttendanceDailyStatus } from "@/domains/attendance/model";
import { STATUS_LABEL, formatMinutesOrNull } from "../format";

/** Every figure here comes straight from the report's own server-computed summary (aggregated
 *  over the full filtered population, never the current page — see `attendanceReportService`),
 *  the same "no client-side aggregation" rule `SummaryCards` (dashboard) already follows. */
export function ReportSummaryCards({
  summary,
}: {
  summary: {
    statusCounts: Record<AttendanceDailyStatus, number>;
    totalScheduledMinutes: number;
    totalWorkedMinutes: number;
    totalOvertimeMinutes: number;
  };
}) {
  const statusCards: { label: string; value: number }[] = (Object.keys(STATUS_LABEL) as AttendanceDailyStatus[]).map((status) => ({
    label: STATUS_LABEL[status],
    value: summary.statusCounts[status],
  }));

  const totalCards: { label: string; value: string }[] = [
    { label: "Total Scheduled", value: formatMinutesOrNull(summary.totalScheduledMinutes) },
    { label: "Total Worked", value: formatMinutesOrNull(summary.totalWorkedMinutes) },
    { label: "Total Overtime", value: formatMinutesOrNull(summary.totalOvertimeMinutes) },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statusCards.map((card) => (
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
      <div className="grid grid-cols-3 gap-3">
        {totalCards.map((card) => (
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
    </div>
  );
}
