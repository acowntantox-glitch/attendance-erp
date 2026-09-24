"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { zonedWallTimeToUtc } from "@/lib/datetime";
import type { AttendanceCorrectionField } from "@/domains/attendance/model";
import { CORRECTION_FIELD_LABEL } from "../format";

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

/**
 * `datetime-local`'s value ("YYYY-MM-DDTHH:mm") has no timezone of its own. The person entering
 * the correction is reading a clock at the employee's own work location, so that wall-clock
 * reading is converted using the employee's configured timezone — never the browser's own system
 * timezone, which may not match (see `zonedWallTimeToUtc`, the same conversion the server uses).
 */
function localDateTimeToIso(value: string, timeZone: string): string | null {
  if (!value) return null;
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return null;
  const date = zonedWallTimeToUtc(datePart, timePart.length === 5 ? `${timePart}:00` : timePart, timeZone);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Missing-punch corrections only (no event picker) — the common "I forgot to check in/out/end my
 * break" case. Correcting the time of an *existing* punch is fully supported by the API (an
 * `eventId` may be supplied) but isn't exposed here yet: doing so safely needs a picker over that
 * day's actual events, which the workspace doesn't currently expose to the client. Deliberate,
 * documented v1 scope — not an oversight.
 */
const FIELD_OPTIONS: AttendanceCorrectionField[] = ["CHECK_IN", "CHECK_OUT", "BREAK_END"];

export function RequestCorrectionDialog({
  employeeId,
  timezone,
  defaultWorkDate,
  onSuccess,
}: {
  employeeId: string;
  timezone: string;
  defaultWorkDate: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fieldChanged, setFieldChanged] = useState<AttendanceCorrectionField>("CHECK_IN");
  const [workDate, setWorkDate] = useState(defaultWorkDate);
  const [correctedValue, setCorrectedValue] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setFieldChanged("CHECK_IN");
    setWorkDate(defaultWorkDate);
    setCorrectedValue("");
    setReason("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const correctedValueIso = localDateTimeToIso(correctedValue, timezone);
    if (!correctedValueIso) {
      setError("Please enter a valid date and time.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/employees/${employeeId}/attendance/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workDate, fieldChanged, correctedValue: correctedValueIso, reason }),
      });
      if (!response.ok) {
        setError(await parseErrorMessage(response, "Unable to submit the correction request."));
        return;
      }
      setOpen(false);
      resetForm();
      onSuccess();
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Request correction
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request an attendance correction</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-slate-500">
            Corrections are reviewed by HR and do not change your original attendance record — HR will see both the original and the
            requested value.
          </p>

          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <Label htmlFor="correction-field">What needs to be corrected?</Label>
            <Select value={fieldChanged} onValueChange={(value) => setFieldChanged(value as AttendanceCorrectionField)}>
              <SelectTrigger id="correction-field">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_OPTIONS.map((field) => (
                  <SelectItem key={field} value={field}>
                    {CORRECTION_FIELD_LABEL[field]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="correction-work-date">Work date</Label>
            <Input id="correction-work-date" type="date" value={workDate} max={defaultWorkDate} onChange={(e) => setWorkDate(e.target.value)} required />
          </div>

          <div>
            <Label htmlFor="correction-value">Correct date &amp; time ({timezone})</Label>
            <Input
              id="correction-value"
              type="datetime-local"
              value={correctedValue}
              onChange={(e) => setCorrectedValue(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="correction-reason">Reason</Label>
            <Textarea
              id="correction-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain what happened and why this correction is needed"
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} aria-busy={submitting}>
              {submitting ? "Submitting…" : "Submit request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
