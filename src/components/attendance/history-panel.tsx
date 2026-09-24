"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AttendanceDailyRecord } from "@/domains/attendance/model";
import { AttendanceStatusBadge } from "./attendance-status-badge";
import { formatDateLabel, formatMinutesOrNull } from "./format";

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29); // last 30 days — a sensible default, not an unbounded fetch
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

/**
 * Fetches from the existing Batch 1 range API (`GET /attendance?from=&to=`) — a small, explicit
 * date window by default, widened only when the person picks a different range themselves. Every
 * column here is a value already present on `AttendanceDailyRecord`; nothing is computed client-side.
 */
export function HistoryPanel({ employeeId }: { employeeId: string }) {
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [records, setRecords] = useState<AttendanceDailyRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/employees/${employeeId}/attendance?from=${from}&to=${to}`);
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          if (!cancelled) setError(body?.error?.message ?? "Unable to load attendance history.");
          return;
        }
        const body = await response.json();
        if (!cancelled) setRecords(body.data as AttendanceDailyRecord[]);
      } catch {
        if (!cancelled) setError("Network error — please check your connection and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [employeeId, from, to]);

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Filter attendance history by date range"
      >
        <div>
          <Label htmlFor="history-from">From</Label>
          <Input id="history-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="history-to">To</Label>
          <Input id="history-to" type="date" value={to} min={from} max={toIsoDate(new Date())} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const range = defaultRange();
            setFrom(range.from);
            setTo(range.to);
          }}
        >
          Last 30 days
        </Button>
      </form>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-slate-100" />
          ))}
        </div>
      ) : records && records.length === 0 ? (
        <p className="px-1 text-sm text-slate-500">No attendance records in this date range.</p>
      ) : records ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead>Worked</TableHead>
              <TableHead>Break</TableHead>
              <TableHead>Late</TableHead>
              <TableHead>Early Departure</TableHead>
              <TableHead>Overtime</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <TableRow key={record.id}>
                <TableCell>{formatDateLabel(record.workDate)}</TableCell>
                <TableCell>
                  <AttendanceStatusBadge status={record.status} />
                </TableCell>
                <TableCell>{formatMinutesOrNull(record.scheduledMinutes)}</TableCell>
                <TableCell>{formatMinutesOrNull(record.workedMinutes)}</TableCell>
                <TableCell>{formatMinutesOrNull(record.breakMinutes)}</TableCell>
                <TableCell>{formatMinutesOrNull(record.lateMinutes)}</TableCell>
                <TableCell>{formatMinutesOrNull(record.earlyDepartureMinutes)}</TableCell>
                <TableCell>{formatMinutesOrNull(record.overtimeMinutes)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
