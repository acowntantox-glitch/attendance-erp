"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Holiday, HolidayType } from "@/domains/workforce/model";

const HOLIDAY_TYPES: HolidayType[] = ["PUBLIC", "RELIGIOUS", "COMPANY", "OPTIONAL"];

type Branch = { id: string; name: string };

type FormState = {
  name: string;
  date: string;
  holidayType: HolidayType;
  description: string;
  scope: "company" | "branch";
  branchId: string;
};

function emptyForm(branches: Branch[]): FormState {
  return {
    name: "",
    date: "",
    holidayType: "PUBLIC",
    description: "",
    scope: "company",
    branchId: branches[0]?.id ?? "",
  };
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

export function HolidaysPanel({
  holidays,
  branches,
  canCreate,
  canUpdate,
  canArchive,
}: {
  holidays: Holiday[];
  branches: Branch[];
  canCreate: boolean;
  canUpdate: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? null;

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm(branches));
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm(branches));
    setFormError(null);
    setOpen(true);
  }

  function openEdit(holiday: Holiday) {
    setEditing(holiday);
    setForm({
      name: holiday.name,
      date: holiday.date,
      holidayType: holiday.holidayType,
      description: holiday.description ?? "",
      scope: holiday.branchId ? "branch" : "company",
      branchId: holiday.branchId ?? branches[0]?.id ?? "",
    });
    setFormError(null);
    setOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      const response = editing
        ? await fetch(`/api/workforce/holidays/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: form.name,
              holidayType: form.holidayType,
              description: form.description || undefined,
            }),
          })
        : await fetch("/api/workforce/holidays", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: form.name,
              date: form.date,
              holidayType: form.holidayType,
              description: form.description || undefined,
              branchId: form.scope === "branch" ? form.branchId : undefined,
            }),
          });

      if (!response.ok) {
        setFormError(await parseErrorMessage(response, "Unable to save this holiday."));
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setFormError("Unable to save this holiday.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSetActive(holiday: Holiday, isActive: boolean) {
    if (!isActive && !window.confirm(`Archive the "${holiday.name}" holiday?`)) return;
    setArchivingId(holiday.id);
    setListError(null);
    try {
      const response = isActive
        ? await fetch(`/api/workforce/holidays/${holiday.id}/restore`, { method: "POST" })
        : await fetch(`/api/workforce/holidays/${holiday.id}`, { method: "DELETE" });

      if (!response.ok) {
        setListError(await parseErrorMessage(response, "Unable to update this holiday."));
        return;
      }
      router.refresh();
    } catch {
      setListError("Unable to update this holiday.");
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {holidays.length} holiday{holidays.length === 1 ? "" : "s"}
        </p>
        {canCreate && <Button onClick={openCreate}>Create Holiday</Button>}
      </div>

      {listError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {listError}
        </div>
      )}

      {holidays.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No holidays configured.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Status</TableHead>
              {(canUpdate || canArchive) && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {holidays.map((holiday) => (
              <TableRow key={holiday.id}>
                <TableCell>
                  <span className="font-medium text-slate-900">{holiday.name}</span>
                  {holiday.description && <div className="text-xs text-slate-400">{holiday.description}</div>}
                </TableCell>
                <TableCell>{holiday.date}</TableCell>
                <TableCell>{holiday.holidayType.replaceAll("_", " ")}</TableCell>
                <TableCell>
                  {holiday.branchId ? (
                    <span>Branch: {branchName(holiday.branchId) ?? "—"}</span>
                  ) : (
                    <span className="text-slate-500">Company-wide</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={holiday.isActive ? "success" : "neutral"}>{holiday.isActive ? "Active" : "Archived"}</Badge>
                </TableCell>
                {(canUpdate || canArchive) && (
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {canUpdate && (
                        <button type="button" onClick={() => openEdit(holiday)} className="text-sm text-blue-700 hover:underline">
                          Edit
                        </button>
                      )}
                      {canArchive && (
                        <button
                          type="button"
                          disabled={archivingId === holiday.id}
                          onClick={() => handleSetActive(holiday, !holiday.isActive)}
                          className="text-sm text-red-600 hover:underline disabled:opacity-50"
                        >
                          {holiday.isActive ? "Archive" : "Restore"}
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
            <DialogTitle>{editing ? "Edit Holiday" : "Create Holiday"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}

            <div>
              <Label htmlFor="holiday-name">Name</Label>
              <Input
                id="holiday-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="New Year's Day"
              />
            </div>

            {editing ? (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label>Date</Label>
                  <p className="text-slate-600">{editing.date} (fixed — create a new holiday to change the date)</p>
                </div>
                <div>
                  <Label>Scope</Label>
                  <p className="text-slate-600">
                    {editing.branchId ? `Branch: ${branchName(editing.branchId) ?? "—"}` : "Company-wide"} (fixed)
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="holiday-date">Date</Label>
                  <Input id="holiday-date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </div>

                <div>
                  <Label htmlFor="holiday-scope">Scope</Label>
                  <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as "company" | "branch" })}>
                    <SelectTrigger id="holiday-scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="company">Company-wide</SelectItem>
                      <SelectItem value="branch">Specific branch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.scope === "branch" && (
                  <div>
                    <Label htmlFor="holiday-branch">Branch</Label>
                    <Select value={form.branchId} onValueChange={(v) => setForm({ ...form, branchId: v })}>
                      <SelectTrigger id="holiday-branch">
                        <SelectValue placeholder={branches.length === 0 ? "No branches available" : "Select a branch"} />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((branch) => (
                          <SelectItem key={branch.id} value={branch.id}>
                            {branch.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}

            <div>
              <Label htmlFor="holiday-type">Type</Label>
              <Select value={form.holidayType} onValueChange={(v) => setForm({ ...form, holidayType: v as HolidayType })}>
                <SelectTrigger id="holiday-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOLIDAY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.replaceAll("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="holiday-description">Description</Label>
              <Input
                id="holiday-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || (!editing && form.scope === "branch" && !form.branchId)}>
                {submitting ? "Saving…" : editing ? "Save Changes" : "Create Holiday"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
