import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ExceptionType = "LATE" | "INCOMPLETE" | "ABSENT" | "EARLY_DEPARTURE";

const LABELS: Record<ExceptionType, string> = {
  LATE: "Late",
  INCOMPLETE: "Incomplete",
  ABSENT: "Absent",
  EARLY_DEPARTURE: "Early Departure",
};

/** Every count is read directly off `AttendanceExceptionListResult.summary` — a GROUP BY over
 *  `attendance_daily_records` for the same filtered population the table shows, never a client-
 *  side count of rendered rows. */
export function ExceptionSummaryCards({ summary }: { summary: Record<ExceptionType, number> }) {
  const cards = (Object.keys(LABELS) as ExceptionType[]).map((type) => ({ type, label: LABELS[type], value: summary[type] }));

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.type}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold text-slate-900">{card.value}</p>
          </CardContent>
        </Card>
      ))}
      {/* Unprocessed is a processing-state concept, not an exception type (see the service's own
          doc) — this is a plain navigational link, not a computed count, so it never implies a
          second query duplicating what the Calendar/period-close preview already compute. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wide text-slate-500">Unprocessed</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Link href="/attendance/calendar" className="text-sm font-medium text-blue-700 hover:underline">
            View in Calendar →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
