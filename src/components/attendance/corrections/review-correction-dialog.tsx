"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AttendanceCorrectionWithDetails } from "@/domains/attendance/model";
import { CORRECTION_FIELD_LABEL, formatDateLabel, formatInstantWithDate } from "../format";
import { CorrectionStatusBadge } from "./correction-status-badge";

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

/**
 * Approve/Reject review surface for one correction — HR only (the trigger is only ever rendered
 * by `HrCorrectionsTable`, which the HR queue page itself is permission-gated behind). Both
 * actions go through the existing `.../approve` / `.../reject` routes; this component never
 * computes or previews a recalculated total itself, it only tells the reviewer that approval
 * *will* trigger one server-side.
 */
export function ReviewCorrectionDialog({
  correction,
  timezone,
  periodClosed,
}: {
  correction: AttendanceCorrectionWithDetails;
  timezone: string;
  periodClosed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [pendingAction, setPendingAction] = useState<"APPROVE" | "REJECT" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitting = pendingAction !== null;

  async function submit(action: "APPROVE" | "REJECT") {
    setPendingAction(action);
    setError(null);
    try {
      const path = action === "APPROVE" ? "approve" : "reject";
      const response = await fetch(`/api/attendance/corrections/${correction.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewNote: reviewNote || undefined }),
      });
      if (!response.ok) {
        setError(await parseErrorMessage(response, "Unable to submit the review."));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setPendingAction(null);
    }
  }

  const employeeName = `${correction.employee.firstName} ${correction.employee.lastName}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          {correction.status === "PENDING" ? "Review" : "View"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attendance correction — {employeeName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Employee</dt>
              <dd className="font-medium text-slate-900">
                {employeeName} ({correction.employee.employeeNumber})
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Work date</dt>
              <dd className="font-medium text-slate-900">{formatDateLabel(correction.workDate)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Field</dt>
              <dd className="font-medium text-slate-900">{CORRECTION_FIELD_LABEL[correction.fieldChanged]}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Status</dt>
              <dd>
                <CorrectionStatusBadge status={correction.status} />
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Original value</dt>
              <dd className="font-medium text-slate-900">{formatInstantWithDate(correction.originalValue, timezone, "Not recorded (missing punch)")}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Requested value</dt>
              <dd className="font-medium text-slate-900">{formatInstantWithDate(correction.correctedValue, timezone)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-slate-500">Reason</dt>
              <dd className="text-slate-900">{correction.reason}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Requested by</dt>
              <dd className="text-slate-900">{correction.requestedBy?.fullName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Requested on</dt>
              <dd className="text-slate-900">{formatInstantWithDate(correction.createdAt, timezone)}</dd>
            </div>
            {correction.status !== "PENDING" && (
              <>
                <div>
                  <dt className="text-slate-500">Reviewed by</dt>
                  <dd className="text-slate-900">{correction.reviewedBy?.fullName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Review note</dt>
                  <dd className="text-slate-900">{correction.reviewNote ?? "—"}</dd>
                </div>
              </>
            )}
          </dl>

          {correction.status === "PENDING" && periodClosed && (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              The attendance period for {formatDateLabel(correction.workDate)} is closed, so this correction can&apos;t be reviewed
              until the period is reopened.
            </p>
          )}

          {correction.status === "PENDING" && (
            <div>
              <Label htmlFor="review-note">Review note (optional)</Label>
              <Textarea id="review-note" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Visible to the requester" />
              <p className="mt-1 text-xs text-slate-400">
                Approving recalculates {employeeName}&apos;s attendance for {formatDateLabel(correction.workDate)} immediately.
              </p>
            </div>
          )}
        </div>

        {correction.status === "PENDING" && (
          <DialogFooter>
            <Button variant="danger" onClick={() => void submit("REJECT")} disabled={submitting || periodClosed} aria-busy={pendingAction === "REJECT"}>
              {pendingAction === "REJECT" ? "Rejecting…" : "Reject"}
            </Button>
            <Button onClick={() => void submit("APPROVE")} disabled={submitting || periodClosed} aria-busy={pendingAction === "APPROVE"}>
              {pendingAction === "APPROVE" ? "Approving…" : "Approve"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
