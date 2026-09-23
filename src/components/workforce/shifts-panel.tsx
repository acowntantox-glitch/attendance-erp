"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { spansMidnight } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTime, formatTimeRange } from "./format";
import type { Shift } from "@/domains/workforce/model";

type FormState = {
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  breakDurationMinutes: string;
  breakStartTime: string;
  isBreakPaid: boolean;
  gracePeriodMinutes: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  code: "",
  startTime: "09:00",
  endTime: "18:00",
  breakDurationMinutes: "",
  breakStartTime: "",
  isBreakPaid: false,
  gracePeriodMinutes: "0",
};

function toFormState(shift: Shift): FormState {
  return {
    name: shift.name,
    code: shift.code,
    startTime: formatTime(shift.startTime),
    endTime: formatTime(shift.endTime),
    breakDurationMinutes: shift.breakDurationMinutes != null ? String(shift.breakDurationMinutes) : "",
    breakStartTime: shift.breakStartTime ? formatTime(shift.breakStartTime) : "",
    isBreakPaid: shift.isBreakPaid,
    gracePeriodMinutes: String(shift.gracePeriodMinutes),
  };
}

function toPayload(form: FormState, includeCode: boolean) {
  return {
    name: form.name,
    ...(includeCode ? { code: form.code } : {}),
    startTime: form.startTime,
    endTime: form.endTime,
    breakDurationMinutes: form.breakDurationMinutes ? Number(form.breakDurationMinutes) : undefined,
    breakStartTime: form.breakStartTime || undefined,
    isBreakPaid: form.isBreakPaid,
    gracePeriodMinutes: form.gracePeriodMinutes ? Number(form.gracePeriodMinutes) : undefined,
  };
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

export function ShiftsPanel({
  shifts,
  canCreate,
  canUpdate,
  canArchive,
}: {
  shifts: Shift[];
  canCreate: boolean;
  canUpdate: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setOpen(true);
  }

  function openEdit(shift: Shift) {
    setEditing(shift);
    setForm(toFormState(shift));
    setFormError(null);
    setOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      const response = editing
        ? await fetch(`/api/workforce/shifts/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(toPayload(form, false)),
          })
        : await fetch("/api/workforce/shifts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(toPayload(form, true)),
          });

      if (!response.ok) {
        setFormError(await parseErrorMessage(response, "Unable to save this shift."));
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setFormError("Unable to save this shift.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSetActive(shift: Shift, isActive: boolean) {
    if (!isActive && !window.confirm(`Archive "${shift.name}"? Employees currently assigned to it will need review.`)) {
      return;
    }
    setArchivingId(shift.id);
    setListError(null);
    try {
      const response = isActive
        ? await fetch(`/api/workforce/shifts/${shift.id}/restore`, { method: "POST" })
        : await fetch(`/api/workforce/shifts/${shift.id}`, { method: "DELETE" });

      if (!response.ok) {
        setListError(await parseErrorMessage(response, "Unable to update this shift."));
        return;
      }
      router.refresh();
    } catch {
      setListError("Unable to update this shift.");
    } finally {
      setArchivingId(null);
    }
  }

  const formIsOvernight = spansMidnight(`${form.startTime}:00`, `${form.endTime}:00`);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {shifts.length} shift{shifts.length === 1 ? "" : "s"}
        </p>
        {canCreate && <Button onClick={openCreate}>Create Shift</Button>}
      </div>

      {listError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {listError}
        </div>
      )}

      {shifts.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No shifts yet.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>Grace</TableHead>
              <TableHead>Break</TableHead>
              <TableHead>Status</TableHead>
              {(canUpdate || canArchive) && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shifts.map((shift) => {
              const overnight = spansMidnight(shift.startTime, shift.endTime);
              return (
                <TableRow key={shift.id}>
                  <TableCell className="font-mono text-xs">{shift.code}</TableCell>
                  <TableCell className="font-medium text-slate-900">{shift.name}</TableCell>
                  <TableCell>
                    {formatTimeRange(shift.startTime, shift.endTime)}
                    {overnight && (
                      <Badge variant="info" className="ml-2">
                        Overnight
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{shift.gracePeriodMinutes} min</TableCell>
                  <TableCell>
                    {shift.breakDurationMinutes ? (
                      <>
                        {shift.breakDurationMinutes} min
                        {shift.breakStartTime ? ` from ${formatTime(shift.breakStartTime)}` : ""}
                        {shift.isBreakPaid ? " (paid)" : ""}
                      </>
                    ) : (
                      <span className="text-slate-400">None</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={shift.isActive ? "success" : "neutral"}>{shift.isActive ? "Active" : "Archived"}</Badge>
                  </TableCell>
                  {(canUpdate || canArchive) && (
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {canUpdate && (
                          <button type="button" onClick={() => openEdit(shift)} className="text-sm text-blue-700 hover:underline">
                            Edit
                          </button>
                        )}
                        {canArchive && (
                          <button
                            type="button"
                            disabled={archivingId === shift.id}
                            onClick={() => handleSetActive(shift, !shift.isActive)}
                            className="text-sm text-red-600 hover:underline disabled:opacity-50"
                          >
                            {shift.isActive ? "Archive" : "Restore"}
                          </button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Shift" : "Create Shift"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="shift-name">Name</Label>
                <Input
                  id="shift-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Night"
                />
              </div>
              <div>
                <Label htmlFor="shift-code">Code</Label>
                <Input
                  id="shift-code"
                  required
                  disabled={Boolean(editing)}
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="NIGHT"
                />
                {!editing && <p className="mt-1 text-xs text-slate-400">Uppercase letters, numbers, hyphens, underscores.</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="shift-start">Start Time</Label>
                <Input
                  id="shift-start"
                  type="time"
                  required
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="shift-end">End Time</Label>
                <Input
                  id="shift-end"
                  type="time"
                  required
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              An end time earlier than or equal to the start time is treated as an overnight shift.
              {formIsOvernight && (
                <Badge variant="info" className="ml-2">
                  This will be an overnight shift
                </Badge>
              )}
            </p>

            <div>
              <Label htmlFor="shift-grace">Grace Period (minutes)</Label>
              <Input
                id="shift-grace"
                type="number"
                min={0}
                value={form.gracePeriodMinutes}
                onChange={(e) => setForm({ ...form, gracePeriodMinutes: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="shift-break-duration">Break Duration (minutes)</Label>
                <Input
                  id="shift-break-duration"
                  type="number"
                  min={0}
                  value={form.breakDurationMinutes}
                  onChange={(e) => setForm({ ...form, breakDurationMinutes: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="shift-break-start">Break Start Time</Label>
                <Input
                  id="shift-break-start"
                  type="time"
                  value={form.breakStartTime}
                  onChange={(e) => setForm({ ...form, breakStartTime: e.target.value })}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isBreakPaid}
                onChange={(e) => setForm({ ...form, isBreakPaid: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              Break is paid
            </label>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : editing ? "Save Changes" : "Create Shift"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
