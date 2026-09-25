import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { AttendancePeriodView } from "@/domains/attendance/periods/attendance-period.service";
import { formatInstantWithDate, formatMonthLabel } from "../format";
import { ClosePeriodDialog } from "./close-period-dialog";
import { ReopenPeriodDialog } from "./reopen-period-dialog";

export function PeriodsTable({
  periods,
  timezone,
  canClose,
  canReopen,
}: {
  periods: AttendancePeriodView[];
  timezone: string;
  canClose: boolean;
  canReopen: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Closed At</TableHead>
          <TableHead>Closed By</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {periods.map((period) => (
          <TableRow key={period.periodMonth}>
            <TableCell className="font-medium text-slate-900">
              {period.status === "CLOSED" && <span aria-hidden="true">🔒 </span>}
              {formatMonthLabel(period.periodMonth)}
              {period.status === "CLOSED" && <span className="sr-only"> — Closed</span>}
            </TableCell>
            <TableCell>
              <Badge variant={period.status === "CLOSED" ? "danger" : "success"}>{period.status === "CLOSED" ? "Closed" : "Open"}</Badge>
            </TableCell>
            <TableCell>{period.status === "CLOSED" ? formatInstantWithDate(period.closedAt, timezone) : "—"}</TableCell>
            <TableCell>{period.status === "CLOSED" ? (period.closedByName ?? "—") : "—"}</TableCell>
            <TableCell className="text-right">
              {period.status === "OPEN" && canClose && <ClosePeriodDialog periodMonth={period.periodMonth} />}
              {period.status === "CLOSED" && canReopen && <ReopenPeriodDialog periodMonth={period.periodMonth} />}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
