"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatMonthLabel } from "../format";

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

export function ReopenPeriodDialog({ periodMonth }: { periodMonth: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReopen() {
    setReopening(true);
    setError(null);
    try {
      const response = await fetch(`/api/attendance/periods/${periodMonth}/reopen`, { method: "POST" });
      if (!response.ok) {
        setError(await parseErrorMessage(response, "Unable to reopen this period."));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setReopening(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          Reopen Period
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reopen {formatMonthLabel(periodMonth)}?</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Reopening this period allows attendance changes, processing, recalculation, and correction activity for this month again.
            Use this only if a genuine correction is required after closing.
          </p>
          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={reopening}>
            Cancel
          </Button>
          <Button onClick={() => void handleReopen()} disabled={reopening} aria-busy={reopening}>
            {reopening ? "Reopening…" : "Confirm Reopen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
