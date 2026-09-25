import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AttendanceCorrectionWithDetails } from "@/domains/attendance/model";
import { CORRECTION_FIELD_LABEL, formatInstantWithDate } from "../format";
import { CorrectionStatusBadge } from "../corrections/correction-status-badge";
import { InvestigationCorrectionAction } from "./investigation-correction-action";

/**
 * Every correction for this work date, any status, straight from `getAttendanceInvestigation`'s
 * `corrections`. No approve/reject controls here: reviewing happens exclusively on
 * `/attendance/corrections` (which already carries its own RBAC nuance — e.g. a MANAGER may
 * request but not approve), so this screen doesn't re-implement that gating. `canRequestCorrection`
 * (already `can(ctx.role, "attendance.correction.request")`, computed once by the page) and
 * `periodClosed` gate the one action this table *does* expose — requesting a new correction for
 * this employee/date, via the same `RequestCorrectionDialog` the self-service page already uses.
 * Hidden (not just disabled) for a closed period, mirroring the exact pattern the Batch 10
 * exceptions table already established, and relying on the page's own closed-period banner for
 * the explanation rather than repeating it here.
 */
export function DayCorrectionsTable({
  corrections,
  timezone,
  employeeId,
  workDate,
  canRequestCorrection,
  periodClosed,
}: {
  corrections: AttendanceCorrectionWithDetails[];
  timezone: string;
  employeeId: string;
  workDate: string;
  canRequestCorrection: boolean;
  periodClosed: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Corrections</CardTitle>
        <div className="flex items-center gap-3">
          {canRequestCorrection && !periodClosed && (
            <InvestigationCorrectionAction employeeId={employeeId} timezone={timezone} workDate={workDate} />
          )}
          <Link href="/attendance/corrections" className="text-sm text-blue-700 hover:underline">
            Review queue →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {corrections.length === 0 ? (
          <p className="px-6 py-4 text-sm text-slate-500">No corrections for this date.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Original Value</TableHead>
                <TableHead>Corrected Value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested By</TableHead>
                <TableHead>Reviewed By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {corrections.map((correction) => (
                <TableRow key={correction.id}>
                  <TableCell>{CORRECTION_FIELD_LABEL[correction.fieldChanged]}</TableCell>
                  <TableCell>{formatInstantWithDate(correction.originalValue, timezone, "Not recorded (missing punch)")}</TableCell>
                  <TableCell>{formatInstantWithDate(correction.correctedValue, timezone)}</TableCell>
                  <TableCell>
                    <CorrectionStatusBadge status={correction.status} />
                  </TableCell>
                  <TableCell>{correction.requestedBy?.fullName ?? "—"}</TableCell>
                  <TableCell>{correction.reviewedBy?.fullName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
