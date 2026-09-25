"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatMonthLabel } from "../format";

type Preview = { openSessionCount: number; unprocessedEmployeeDays: number };

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

/**
 * The confirmation dialog itself is not what enforces the lock (§4) — closing here is a normal
 * API call the server independently authorizes and validates; this dialog only exists so HR sees
 * the consequences before confirming, and sees the same open-session block the server would
 * enforce anyway if they skipped straight to the API.
 */
export function ClosePeriodDialog({ periodMonth }: { periodMonth: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    setError(null);
    if (next) {
      setLoadingPreview(true);
      try {
        const response = await fetch(`/api/attendance/periods/${periodMonth}/preview`);
        if (response.ok) {
          const body = await response.json();
          setPreview(body.data as Preview);
        }
      } finally {
        setLoadingPreview(false);
      }
    } else {
      setPreview(null);
    }
  }

  async function handleClose() {
    setClosing(true);
    setError(null);
    try {
      const response = await fetch(`/api/attendance/periods/${periodMonth}/close`, { method: "POST" });
      if (!response.ok) {
        setError(await parseErrorMessage(response, "Unable to close this period."));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setClosing(false);
    }
  }

  const blocked = Boolean(preview && preview.openSessionCount > 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">Close Period</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close {formatMonthLabel(periodMonth)}?</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Closing this period will prevent attendance changes, processing, recalculation, and correction activity for this month.
            Historical attendance will remain available for viewing.
          </p>

          {loadingPreview && <p className="text-slate-400">Checking for open sessions…</p>}

          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {preview && preview.openSessionCount > 0 && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {preview.openSessionCount} attendance session{preview.openSessionCount === 1 ? " is" : "s are"} still open in this period.
              Resolve {preview.openSessionCount === 1 ? "it" : "them"} (a normal check-out, or a correction) before closing.
            </div>
          )}

          {preview && preview.unprocessedEmployeeDays > 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              {preview.unprocessedEmployeeDays} employee-day{preview.unprocessedEmployeeDays === 1 ? "" : "s"} in this period have not
              been processed yet. You can still close — unprocessed days will simply remain unprocessed, never materialized as
              automatically as part of closing.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={closing}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void handleClose()} disabled={closing || blocked || loadingPreview} aria-busy={closing}>
            {closing ? "Closing…" : "Confirm Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
