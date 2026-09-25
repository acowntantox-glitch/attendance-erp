"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ExceptionType = "LATE" | "INCOMPLETE" | "ABSENT" | "EARLY_DEPARTURE";

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

/**
 * Never optimistic — the row stays as-is until the server confirms the dismissal, then
 * `router.refresh()` re-fetches the authoritative queue. If the mutation fails, the UI is left
 * exactly as it was (the row is never removed client-side before the server confirms it).
 */
export function DismissExceptionDialog({
  employeeId,
  workDate,
  exceptionType,
  employeeName,
}: {
  employeeId: string;
  workDate: string;
  exceptionType: ExceptionType;
  employeeName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDismiss() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/attendance/exceptions/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, workDate, exceptionType, note: note || undefined }),
      });
      if (!response.ok) {
        setError(await parseErrorMessage(response, "Unable to dismiss this exception."));
        return;
      }
      setOpen(false);
      setNote("");
      router.refresh();
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          Dismiss
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dismiss this exception?</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm text-slate-600">
          <p>
            This marks {employeeName}&apos;s {workDate} exception as reviewed. It does not change any attendance data — the underlying
            record stays exactly as calculated, and this can be undone at any time from &quot;Show dismissed.&quot;
          </p>

          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <Label htmlFor="dismiss-note">Note (optional)</Label>
            <Textarea id="dismiss-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this needs no further action" />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleDismiss()} disabled={submitting} aria-busy={submitting}>
            {submitting ? "Dismissing…" : "Dismiss"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
