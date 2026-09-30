"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttendancePolicyView } from "@/domains/attendance/policy/attendance-policy.service";

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

type FieldKey = "defaultGracePeriodMinutes" | "earlyDepartureGraceMinutes" | "overtimeThresholdMinutes" | "minimumWorkedMinutes";

const FIELDS: { key: FieldKey; label: string; description: string; max: number; optional?: boolean }[] = [
  {
    key: "defaultGracePeriodMinutes",
    label: "Default grace period (minutes)",
    description: "Used when an employee has a work schedule without a shift-specific grace period.",
    max: 240,
  },
  {
    key: "earlyDepartureGraceMinutes",
    label: "Early departure grace (minutes)",
    description: "Minutes allowed before early departure is recorded.",
    max: 240,
  },
  {
    key: "overtimeThresholdMinutes",
    label: "Overtime threshold (minutes)",
    description: "Minutes after scheduled working time before overtime begins.",
    max: 480,
  },
  {
    key: "minimumWorkedMinutes",
    label: "Minimum worked minutes",
    description:
      "Minimum worked time required before a complete scheduled day is classified as Under Hours. Leave blank to disable. Never exceeds the day's scheduled minutes.",
    max: 1440,
    optional: true,
  },
];

export function AttendancePolicyPanel({ policy, canManage }: { policy: AttendancePolicyView; canManage: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<FieldKey, string>>({
    defaultGracePeriodMinutes: String(policy.defaultGracePeriodMinutes),
    earlyDepartureGraceMinutes: String(policy.earlyDepartureGraceMinutes),
    overtimeThresholdMinutes: String(policy.overtimeThresholdMinutes),
    minimumWorkedMinutes: policy.minimumWorkedMinutes === null ? "" : String(policy.minimumWorkedMinutes),
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    const payload: Record<string, number | null> = {};
    for (const field of FIELDS) {
      const raw = values[field.key].trim();
      if (raw === "" && field.optional) {
        payload[field.key] = null;
        continue;
      }
      const parsed = Number(raw);
      if (raw === "" || !Number.isInteger(parsed) || parsed < 0 || parsed > field.max) {
        setError(`${field.label} must be a whole number between 0 and ${field.max}.`);
        return;
      }
      payload[field.key] = parsed;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/attendance/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setError(await parseErrorMessage(response, "Unable to save the attendance policy."));
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Unable to save the attendance policy.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company Attendance Policy</CardTitle>
      </CardHeader>
      <CardContent>
        <div role="note" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Attendance policy changes apply to attendance calculations performed after the policy is updated. Existing attendance records are
          not automatically recalculated.
        </div>
        {policy.isDefault && (
          <p className="mb-4 text-sm text-slate-500">
            No policy has been saved yet — built-in defaults apply (no grace, no thresholds, Under Hours disabled).
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {saved && (
            <div role="status" className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              Attendance policy saved.
            </div>
          )}

          {FIELDS.map((field) => (
            <div key={field.key} className="max-w-md">
              <Label htmlFor={`policy-${field.key}`}>{field.label}</Label>
              <Input
                id={`policy-${field.key}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={field.max}
                step={1}
                value={values[field.key]}
                placeholder={field.optional ? "Disabled" : undefined}
                disabled={!canManage}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
              />
              <p className="mt-1 text-xs text-slate-500">{field.description}</p>
            </div>
          ))}

          {canManage && (
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save Policy"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
