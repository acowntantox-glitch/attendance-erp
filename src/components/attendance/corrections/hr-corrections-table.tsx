import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AttendanceCorrectionWithDetails } from "@/domains/attendance/model";
import { CORRECTION_FIELD_LABEL, formatDateLabel, formatInstantWithDate } from "../format";
import { CorrectionStatusBadge } from "./correction-status-badge";
import { ReviewCorrectionDialog } from "./review-correction-dialog";

/** No ranking or scoring — a plain chronological queue, most recently requested first (as
 *  returned by `listCompanyCorrections`), matching the batch's explicit "do not create
 *  ranking/scoring" instruction. */
export function HrCorrectionsTable({
  corrections,
  timezone,
  closedMonths,
}: {
  corrections: AttendanceCorrectionWithDetails[];
  timezone: string;
  /** Months (YYYY-MM) whose attendance period is closed, among those present in `corrections` —
   *  used to disable/explain review actions for a correction whose own `workDate` falls in a
   *  closed period (§29), without a per-row period lookup. */
  closedMonths: Set<string>;
}) {
  if (corrections.length === 0) {
    return <p className="px-1 py-4 text-sm text-slate-500">No corrections in this view.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Employee #</TableHead>
          <TableHead>Work Date</TableHead>
          <TableHead>Field</TableHead>
          <TableHead>Requested Value</TableHead>
          <TableHead>Requester</TableHead>
          <TableHead>Requested On</TableHead>
          <TableHead>Status</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {corrections.map((correction) => (
          <TableRow key={correction.id}>
            <TableCell className="font-medium text-slate-900">
              {correction.employee.firstName} {correction.employee.lastName}
            </TableCell>
            <TableCell className="font-mono text-xs">{correction.employee.employeeNumber}</TableCell>
            <TableCell>{formatDateLabel(correction.workDate)}</TableCell>
            <TableCell>{CORRECTION_FIELD_LABEL[correction.fieldChanged]}</TableCell>
            <TableCell>{formatInstantWithDate(correction.correctedValue, timezone)}</TableCell>
            <TableCell>{correction.requestedBy?.fullName ?? "—"}</TableCell>
            <TableCell>{formatInstantWithDate(correction.createdAt, timezone)}</TableCell>
            <TableCell>
              <CorrectionStatusBadge status={correction.status} />
            </TableCell>
            <TableCell>
              <ReviewCorrectionDialog correction={correction} timezone={timezone} periodClosed={closedMonths.has(correction.workDate.slice(0, 7))} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
