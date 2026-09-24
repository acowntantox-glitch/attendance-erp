"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttendanceDailyStatus } from "@/domains/attendance/model";

type ProcessResult = {
  workDate: string;
  totalEmployees: number;
  processed: number;
  created: number;
  updated: number;
  failed: number;
  statusCounts: Record<AttendanceDailyStatus, number>;
};

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

/**
 * Minimal HR processing control (Batch 5) — materializes ABSENT/HOLIDAY/WEEKLY_OFF/NO_SCHEDULE
 * daily records for employees who have no attendance record yet on `workDate`. Never touches
 * `attendance_events`/`attendance_open_sessions`; safe to click more than once (the underlying
 * upsert is idempotent). Only rendered by the page when the caller holds
 * `attendance.recalculate` — the API route enforces this independently either way.
 */
export function ProcessDayButton({ workDate }: { workDate: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);

  async function handleProcess() {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/attendance/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workDate }),
      });
      if (!response.ok) {
        setError(await parseErrorMessage(response, "Unable to process attendance for this date."));
        return;
      }
      const body = await response.json();
      setResult(body.data as ProcessResult);
      router.refresh();
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Process Day</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-500">
          Computes and saves a daily attendance record for every eligible employee who doesn&apos;t have one yet for this date —
          including marking days ABSENT where nothing was recorded. Never creates a check-in/check-out event, and is safe to run more
          than once.
        </p>

        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <Button onClick={() => void handleProcess()} disabled={submitting} aria-busy={submitting}>
          {submitting ? "Processing…" : "Process Day"}
        </Button>

        {result && (
          <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-4">
            <SummaryStat label="Processed" value={result.processed} />
            <SummaryStat label="Present" value={result.statusCounts.PRESENT} />
            <SummaryStat label="Late" value={result.statusCounts.LATE} />
            <SummaryStat label="Absent" value={result.statusCounts.ABSENT} />
            <SummaryStat label="Incomplete" value={result.statusCounts.INCOMPLETE} />
            <SummaryStat label="Weekly Off" value={result.statusCounts.WEEKLY_OFF + result.statusCounts.WEEKLY_OFF_WORKED} />
            <SummaryStat label="Holiday" value={result.statusCounts.HOLIDAY + result.statusCounts.HOLIDAY_WORKED} />
            <SummaryStat label="No Schedule" value={result.statusCounts.NO_SCHEDULE} />
            <SummaryStat label="Failed" value={result.failed} />
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
