"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTime, formatTimeRange } from "./format";
import type { WorkSchedule } from "@/domains/workforce/model";

type FormState = {
  name: string;
  description: string;
  timezone: string;
  startTime: string;
  endTime: string;
  breakDurationMinutes: string;
  breakStartTime: string;
  isBreakPaid: boolean;
  effectiveFrom: string;
  effectiveTo: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  timezone: "",
  startTime: "09:00",
  endTime: "18:00",
  breakDurationMinutes: "",
  breakStartTime: "",
  isBreakPaid: false,
  effectiveFrom: "",
  effectiveTo: "",
};

function toFormState(schedule: WorkSchedule): FormState {
  return {
    name: schedule.name,
    description: schedule.description ?? "",
    timezone: schedule.timezone ?? "",
    startTime: formatTime(schedule.startTime),
    endTime: formatTime(schedule.endTime),
    breakDurationMinutes: schedule.breakDurationMinutes != null ? String(schedule.breakDurationMinutes) : "",
    breakStartTime: schedule.breakStartTime ? formatTime(schedule.breakStartTime) : "",
    isBreakPaid: schedule.isBreakPaid,
    effectiveFrom: schedule.effectiveFrom ?? "",
    effectiveTo: schedule.effectiveTo ?? "",
  };
}

function toPayload(form: FormState) {
  return {
    name: form.name,
    description: form.description || undefined,
    timezone: form.timezone || undefined,
    startTime: form.startTime,
    endTime: form.endTime,
    breakDurationMinutes: form.breakDurationMinutes ? Number(form.breakDurationMinutes) : undefined,
    breakStartTime: form.breakStartTime || undefined,
    isBreakPaid: form.isBreakPaid,
    effectiveFrom: form.effectiveFrom || undefined,
    effectiveTo: form.effectiveTo || undefined,
  };
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

export function WorkSchedulesPanel({
  schedules,
  canCreate,
  canUpdate,
  canArchive,
}: {
  schedules: WorkSchedule[];
  canCreate: boolean;
  canUpdate: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WorkSchedule | null>(null);
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

  function openEdit(schedule: WorkSchedule) {
    setEditing(schedule);
    setForm(toFormState(schedule));
    setFormError(null);
    setOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      const response = editing
        ? await fetch(`/api/workforce/schedules/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(toPayload(form)),
          })
        : await fetch("/api/workforce/schedules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(toPayload(form)),
          });

      if (!response.ok) {
        setFormError(await parseErrorMessage(response, "Unable to save this work schedule."));
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setFormError("Unable to save this work schedule.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSetActive(schedule: WorkSchedule, isActive: boolean) {
    if (!isActive && !window.confirm(`Archive "${schedule.name}"? Employees currently assigned to it will need review.`)) {
      return;
    }
    setArchivingId(schedule.id);
    setListError(null);
    try {
      const response = isActive
        ? await fetch(`/api/workforce/schedules/${schedule.id}/restore`, { method: "POST" })
        : await fetch(`/api/workforce/schedules/${schedule.id}`, { method: "DELETE" });

      if (!response.ok) {
        setListError(await parseErrorMessage(response, "Unable to update this work schedule."));
        return;
      }
      router.refresh();
    } catch {
      setListError("Unable to update this work schedule.");
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {schedules.length} schedule{schedules.length === 1 ? "" : "s"}
        </p>
        {canCreate && <Button onClick={openCreate}>Create Schedule</Button>}
      </div>

      {listError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {listError}
        </div>
      )}

      {schedules.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No work schedules yet.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>Timezone</TableHead>
              <TableHead>Break</TableHead>
              <TableHead>Effective</TableHead>
              <TableHead>Status</TableHead>
              {(canUpdate || canArchive) && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedules.map((schedule) => (
              <TableRow key={schedule.id}>
                <TableCell>
                  <span className="font-medium text-slate-900">{schedule.name}</span>
                  {schedule.description && <div className="text-xs text-slate-400">{schedule.description}</div>}
                </TableCell>
                <TableCell>{formatTimeRange(schedule.startTime, schedule.endTime)}</TableCell>
                <TableCell>{schedule.timezone ?? <span className="text-slate-400">Company default</span>}</TableCell>
                <TableCell>
                  {schedule.breakDurationMinutes ? (
                    <>
                      {schedule.breakDurationMinutes} min
                      {schedule.breakStartTime ? ` from ${formatTime(schedule.breakStartTime)}` : ""}
                      {schedule.isBreakPaid ? " (paid)" : ""}
                    </>
                  ) : (
                    <span className="text-slate-400">None</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {schedule.effectiveFrom || schedule.effectiveTo ? (
                    <>
                      {schedule.effectiveFrom ?? "—"} → {schedule.effectiveTo ?? "—"}
                    </>
                  ) : (
                    <span className="text-slate-400">Always</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={schedule.isActive ? "success" : "neutral"}>{schedule.isActive ? "Active" : "Archived"}</Badge>
                </TableCell>
                {(canUpdate || canArchive) && (
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {canUpdate && (
                        <button type="button" onClick={() => openEdit(schedule)} className="text-sm text-blue-700 hover:underline">
                          Edit
                        </button>
                      )}
                      {canArchive && (
                        <button
                          type="button"
                          disabled={archivingId === schedule.id}
                          onClick={() => handleSetActive(schedule, !schedule.isActive)}
                          className="text-sm text-red-600 hover:underline disabled:opacity-50"
                        >
                          {schedule.isActive ? "Archive" : "Restore"}
                        </button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Work Schedule" : "Create Work Schedule"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}

            <div>
              <Label htmlFor="schedule-name">Name</Label>
              <Input
                id="schedule-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Standard Week"
              />
            </div>

            <div>
              <Label htmlFor="schedule-description">Description</Label>
              <Input
                id="schedule-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional"
              />
            </div>

            <div>
              <Label htmlFor="schedule-timezone">Timezone</Label>
              <Input
                id="schedule-timezone"
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                placeholder="Defaults to the company timezone (e.g. Asia/Dubai)"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="schedule-start">Start Time</Label>
                <Input
                  id="schedule-start"
                  type="time"
                  required
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="schedule-end">End Time</Label>
                <Input
                  id="schedule-end"
                  type="time"
                  required
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="schedule-break-duration">Break Duration (minutes)</Label>
                <Input
                  id="schedule-break-duration"
                  type="number"
                  min={0}
                  value={form.breakDurationMinutes}
                  onChange={(e) => setForm({ ...form, breakDurationMinutes: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="schedule-break-start">Break Start Time</Label>
                <Input
                  id="schedule-break-start"
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

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="schedule-effective-from">Effective From</Label>
                <Input
                  id="schedule-effective-from"
                  type="date"
                  value={form.effectiveFrom}
                  onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="schedule-effective-to">Effective To</Label>
                <Input
                  id="schedule-effective-to"
                  type="date"
                  value={form.effectiveTo}
                  onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-slate-400">
              Leave effective dates blank for a schedule that&apos;s always applicable. These govern the template itself, not any
              individual employee&apos;s assignment dates.
            </p>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : editing ? "Save Changes" : "Create Schedule"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
