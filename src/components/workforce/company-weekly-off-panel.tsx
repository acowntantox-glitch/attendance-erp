"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WeekdaySelect, formatOffDays } from "./weekday-select";
import type { WeeklyOffRule } from "@/domains/workforce/model";

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

export function CompanyWeeklyOffPanel({ rule, canManage }: { rule: WeeklyOffRule | null; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [offDays, setOffDays] = useState<number[]>(rule?.offDays ?? []);
  const [effectiveFrom, setEffectiveFrom] = useState(rule?.effectiveFrom ?? "");
  const [effectiveTo, setEffectiveTo] = useState(rule?.effectiveTo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function openDialog() {
    setOffDays(rule?.offDays ?? []);
    setEffectiveFrom(rule?.effectiveFrom ?? "");
    setEffectiveTo(rule?.effectiveTo ?? "");
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
      const response = await fetch("/api/workforce/weekly-offs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offDays,
          effectiveFrom: effectiveFrom || undefined,
          effectiveTo: effectiveTo || undefined,
        }),
      });

      if (!response.ok) {
        setError(await parseErrorMessage(response, "Unable to save the company default."));
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setError("Unable to save the company default.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company Default</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rule ? (
          <div>
            <p className="text-sm text-slate-500">Off days</p>
            <p className="text-base font-medium text-slate-900">{formatOffDays(rule.offDays)}</p>
            {(rule.effectiveFrom || rule.effectiveTo) && (
              <p className="mt-1 text-xs text-slate-400">
                Effective {rule.effectiveFrom ?? "always"} → {rule.effectiveTo ?? "ongoing"}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No company default weekly-off rule configured yet.</p>
        )}

        {canManage && <Button onClick={openDialog}>{rule ? "Update Default" : "Set Default"}</Button>}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Company Default Weekly Off</DialogTitle>
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
                <Label htmlFor="default-effective-from">Effective From</Label>
                <Input
                  id="default-effective-from"
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="default-effective-to">Effective To</Label>
                <Input id="default-effective-to" type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-slate-400">Leave blank for a default that always applies.</p>

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
    </Card>
  );
}
