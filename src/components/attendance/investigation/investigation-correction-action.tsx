"use client";

import { useRouter } from "next/navigation";
import { RequestCorrectionDialog } from "../corrections/request-correction-dialog";

/**
 * Restores the HR "Request correction" capability on the employee investigation page (regression
 * fixed after the Batch 7–10 audit — Batch 9 replaced `AttendanceWorkspace`/`EmployeeCorrectionsPanel`
 * here with a read-only layout and never re-added an equivalent control). This is a thin wrapper
 * around the *existing* `RequestCorrectionDialog` — same service, same validation, same
 * conflict/period-lock guards, same API route — the only thing added is `onSuccess`, since this
 * page is a Server Component and needs `router.refresh()` (not a client-side refetch) to see the
 * new request appear in `DayCorrectionsTable`.
 */
export function InvestigationCorrectionAction({ employeeId, timezone, workDate }: { employeeId: string; timezone: string; workDate: string }) {
  const router = useRouter();
  return <RequestCorrectionDialog employeeId={employeeId} timezone={timezone} defaultWorkDate={workDate} onSuccess={() => router.refresh()} />;
}
