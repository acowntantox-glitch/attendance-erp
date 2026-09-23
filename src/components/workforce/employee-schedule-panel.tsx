"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatTimeRange } from "./format";
import type { EmployeeScheduleAssignmentWithHistory, Shift, WorkSchedule } from "@/domains/workforce/model";

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

function AssignmentRow({ assignment }: { assignment: EmployeeScheduleAssignmentWithHistory }) {
  const source = assignment.shift ?? assignment.workSchedule;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-900">{assignment.workSchedule.name}</p>
          {assignment.shift && <p className="text-xs text-slate-500">Shift override: {assignment.shift.name}</p>}
        </div>
        <p className="text-sm text-slate-600">{formatTimeRange(source.startTime, source.endTime)}</p>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        {assignment.effectiveFrom} → {assignment.effectiveTo ?? "ongoing"}
        {assignment.assignedBy && ` · Assigned by ${assignment.assignedBy.fullName}`}
      </p>
      {assignment.note && <p className="mt-1 text-xs italic text-slate-500">&ldquo;{assignment.note}&rdquo;</p>}
    </div>
  );
}

export function EmployeeSchedulePanel({
  employeeId,
  assignments,
  workSchedules,
  shifts,
  canCreate,
  today,
}: {
  employeeId: string;
  assignments: EmployeeScheduleAssignmentWithHistory[];
  workSchedules: WorkSchedule[];
  shifts: Shift[];
  canCreate: boolean;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [workScheduleId, setWorkScheduleId] = useState("");
  const [shiftId, setShiftId] = useState<string>("none");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [note, setNote] = useState("");
  const [allowOverlap, setAllowOverlap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const current = assignments.find((a) => a.effectiveFrom <= today && (a.effectiveTo === null || a.effectiveTo >= today));
  const future = assignments.filter((a) => a.effectiveFrom > today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const history = assignments.filter((a) => a !== current && !future.includes(a));

  function openDialog() {
    setWorkScheduleId(workSchedules[0]?.id ?? "");
    setShiftId("none");
    setEffectiveFrom("");
    setEffectiveTo("");
    setNote("");
    setAllowOverlap(false);
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (allowOverlap && !note.trim()) {
      setError("A note is required when overriding overlap protection.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/employees/${employeeId}/schedule-assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workScheduleId,
          shiftId: shiftId === "none" ? undefined : shiftId,
          effectiveFrom,
          effectiveTo: effectiveTo || undefined,
          note: note || undefined,
          allowOverlap: allowOverlap || undefined,
        }),
      });

      if (!response.ok) {
        setError(await parseErrorMessage(response, "Unable to save this schedule assignment."));
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setError("Unable to save this schedule assignment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {canCreate && (
        <div className="flex justify-end">
          <Button onClick={openDialog} disabled={workSchedules.length === 0}>
            {current ? "Change Schedule" : "Assign Schedule"}
          </Button>
        </div>
      )}
      {canCreate && workSchedules.length === 0 && (
        <p className="text-right text-xs text-slate-400">Create a work schedule first (Workforce → Schedules).</p>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Current</h3>
        {current ? (
          <AssignmentRow assignment={current} />
        ) : (
          <p className="text-sm text-slate-500">No schedule currently assigned.</p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Upcoming</h3>
        {future.length > 0 ? (
          <div className="space-y-2">
            {future.map((a) => (
              <AssignmentRow key={a.id} assignment={a} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No upcoming schedule changes.</p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">History</h3>
        {history.length > 0 ? (
          <div className="space-y-2">
            {history.map((a) => (
              <AssignmentRow key={a.id} assignment={a} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No assignment history yet.</p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{current ? "Change Schedule" : "Assign Schedule"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div>
              <Label htmlFor="assign-schedule">Work Schedule</Label>
              <Select value={workScheduleId} onValueChange={setWorkScheduleId}>
                <SelectTrigger id="assign-schedule">
                  <SelectValue placeholder="Select a schedule" />
                </SelectTrigger>
                <SelectContent>
                  {workSchedules.map((schedule) => (
                    <SelectItem key={schedule.id} value={schedule.id}>
                      {schedule.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="assign-shift">Shift (optional override)</Label>
              <Select value={shiftId} onValueChange={setShiftId}>
                <SelectTrigger id="assign-shift">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Use the schedule&apos;s default hours</SelectItem>
                  {shifts.map((shift) => (
                    <SelectItem key={shift.id} value={shift.id}>
                      {shift.name} ({shift.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="assign-from">Effective From</Label>
                <Input
                  id="assign-from"
                  type="date"
                  required
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="assign-to">Effective To</Label>
                <Input id="assign-to" type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
              </div>
            </div>
            {current && (
              <p className="text-xs text-slate-400">
                If this starts after the current assignment&apos;s start date, the current assignment will automatically be closed
                the day before this one begins.
              </p>
            )}

            <div>
              <Label htmlFor="assign-note">Note</Label>
              <Input id="assign-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={allowOverlap}
                onChange={(e) => setAllowOverlap(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span>
                <span className="font-medium">Allow this to overlap an existing assignment</span> — an exception to normal overlap
                protection. Requires a note explaining why.
              </span>
            </label>
            {allowOverlap && (
              <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                This bypasses the usual check that prevents two schedules applying to the same employee on the same date. Use only
                for a deliberate administrative correction.
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !workScheduleId || !effectiveFrom}>
                {submitting ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
