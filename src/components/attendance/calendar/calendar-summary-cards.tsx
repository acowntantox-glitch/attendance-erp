import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttendanceDailyStatus } from "@/domains/attendance/model";
import { STATUS_LABEL } from "../format";

/**
 * Every figure here comes straight from the service's server-computed month summary — aggregated
 * over the entire filtered employee population, never just the current page of employees (§17).
 * "Unprocessed" is explicitly labeled as such, never folded into (or presented as) "Absent" —
 * Batch 5's own rule, preserved at this presentation layer (§13).
 */
export function CalendarSummaryCards({
  summary,
}: {
  summary: {
    totalEmployees: number;
    processedEmployeeDays: number;
    unprocessedEmployeeDays: number;
    statusCounts: Record<AttendanceDailyStatus, number>;
  };
}) {
  const cards: { label: string; value: number }[] = [
    { label: "Employees", value: summary.totalEmployees },
    { label: "Processed Employee-Days", value: summary.processedEmployeeDays },
    { label: STATUS_LABEL.PRESENT, value: summary.statusCounts.PRESENT },
    { label: STATUS_LABEL.LATE, value: summary.statusCounts.LATE },
    { label: STATUS_LABEL.ABSENT, value: summary.statusCounts.ABSENT },
    { label: STATUS_LABEL.INCOMPLETE, value: summary.statusCounts.INCOMPLETE },
    { label: "Unprocessed", value: summary.unprocessedEmployeeDays },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
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
  );
}
