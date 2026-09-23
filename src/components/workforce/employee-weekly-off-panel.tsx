"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WeekdaySelect, formatOffDays } from "./weekday-select";
import type { WeeklyOffRule } from "@/domains/workforce/model";

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

export function EmployeeWeeklyOffPanel({
  employeeId,
  override,
  companyDefault,
  canViewCompanyDefault,
  canManage,
}: {
  employeeId: string;
  override: WeeklyOffRule | null;
  companyDefault: WeeklyOffRule | null;
  /** Distinguishes "no permission to see the company default" from "none is configured" —
   *  companyDefault alone is null in both cases, and an EMPLOYEE without weekly_off.view must
   *  never be told whether a company-wide default exists at all. */
  canViewCompanyDefault: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [offDays, setOffDays] = useState<number[]>(override?.offDays ?? []);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function openDialog() {
    setOffDays(override?.offDays ?? []);
    setEffectiveFrom("");
    setEffectiveTo("");
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (offDays.length === 0) {
      setError("Select at least one off day.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/employees/${employeeId}/weekly-off-override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offDays,
          effectiveFrom: effectiveFrom || undefined,
          effectiveTo: effectiveTo || undefined,
        }),
      });

      if (!response.ok) {
        setError(await parseErrorMessage(response, "Unable to save this weekly-off override."));
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setError("Unable to save this weekly-off override.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {canViewCompanyDefault && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Company Default</p>
          <p className="text-sm text-slate-700">
            {companyDefault ? formatOffDays(companyDefault.offDays) : "No company default configured yet."}
          </p>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Employee Override</p>
        {override ? (
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="info">Override active</Badge>
            <div>
              <p className="text-sm font-medium text-slate-900">{formatOffDays(override.offDays)}</p>
              {(override.effectiveFrom || override.effectiveTo) && (
                <p className="text-xs text-slate-400">
                  Effective {override.effectiveFrom ?? "always"} → {override.effectiveTo ?? "ongoing"}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            {canViewCompanyDefault
              ? `No override — ${companyDefault ? "uses the company default." : "no company default is configured either."}`
              : "No override set."}
          </p>
        )}
      </div>

      {canManage && (
        <Button variant="secondary" size="sm" onClick={openDialog}>
          {override ? "Change Override" : "Set Override"}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Weekly-Off Override</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div>
              <Label>Off Days</Label>
              <WeekdaySelect value={offDays} onChange={setOffDays} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="override-from">Effective From</Label>
                <Input id="override-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="override-to">Effective To</Label>
                <Input id="override-to" type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
              </div>
            </div>
            {override && (
              <p className="text-xs text-slate-400">
                Setting a new override replaces the current one; if the new start date is later than the current override&apos;s
                start date, the existing override ends the day before.
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
