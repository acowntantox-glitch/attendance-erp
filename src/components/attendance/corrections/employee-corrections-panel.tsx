"use client";

import { useEffect, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AttendanceCorrectionWithDetails } from "@/domains/attendance/model";
import { CORRECTION_FIELD_LABEL, formatDateLabel, formatInstantWithDate } from "../format";
import { CorrectionStatusBadge } from "./correction-status-badge";
import { RequestCorrectionDialog } from "./request-correction-dialog";

/**
 * Self-contained "corrections" surface for one employee's attendance workspace — used both by the
 * employee's own `/attendance` page and by an HR/manager viewing `/employees/[id]/attendance`
 * (which is why `canRequest` is a prop rather than assumed: the backend, not this component,
 * decides who may request on whose behalf — see `requestCorrection`'s self-scope/company-scope
 * rules). Every correction shown here comes straight from `GET .../attendance/corrections`; this
 * component never edits an existing correction, only creates new ones (§ "Do not allow editing an
 * existing correction. Create a new correction instead.").
 */
export function EmployeeCorrectionsPanel({
  employeeId,
  timezone,
  canRequest,
  defaultWorkDate,
}: {
  employeeId: string;
  timezone: string;
  canRequest: boolean;
  defaultWorkDate: string;
}) {
  const [corrections, setCorrections] = useState<AttendanceCorrectionWithDetails[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped to re-run the fetch effect below (e.g. after a new correction is submitted) — same
  // "effect re-fetches, callers never call setState directly" shape as `HistoryPanel`.
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        const response = await fetch(`/api/employees/${employeeId}/attendance/corrections`);
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          if (!cancelled) setError(body?.error?.message ?? "Unable to load corrections.");
          return;
        }
        const body = await response.json();
        if (!cancelled) setCorrections(body.data as AttendanceCorrectionWithDetails[]);
      } catch {
        if (!cancelled) setError("Network error — please check your connection and try again.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [employeeId, refreshToken]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Requested corrections for this employee, and their review status.</p>
        {canRequest && (
          <RequestCorrectionDialog
            employeeId={employeeId}
            timezone={timezone}
            defaultWorkDate={defaultWorkDate}
            onSuccess={() => setRefreshToken((n) => n + 1)}
          />
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {corrections === null ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-slate-100" />
          ))}
        </div>
      ) : corrections.length === 0 ? (
        <p className="px-1 text-sm text-slate-500">No corrections requested yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Work Date</TableHead>
              <TableHead>Field</TableHead>
              <TableHead>Requested Value</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Review Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {corrections.map((correction) => (
              <TableRow key={correction.id}>
                <TableCell>{formatDateLabel(correction.workDate)}</TableCell>
                <TableCell>{CORRECTION_FIELD_LABEL[correction.fieldChanged]}</TableCell>
                <TableCell>{formatInstantWithDate(correction.correctedValue, timezone)}</TableCell>
                <TableCell className="max-w-xs truncate" title={correction.reason}>
                  {correction.reason}
                </TableCell>
                <TableCell>
                  <CorrectionStatusBadge status={correction.status} />
                </TableCell>
                <TableCell className="max-w-xs truncate" title={correction.reviewNote ?? undefined}>
                  {correction.reviewNote ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
