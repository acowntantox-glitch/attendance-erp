"use client";

import Link from "next/link";
import type { ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays } from "@/lib/datetime";
import { formatDateLabel } from "../format";

/**
 * Pure URL-navigation, matching this app's existing filter/pagination convention (see
 * `Pagination`, `EmployeeFilterBar`) — every control here changes the `date` query param and lets
 * the Server Component re-fetch, rather than holding date state client-side. The backend remains
 * the sole authority on what "today" and each work date mean; this component only ever builds
 * links, it never computes a workDate itself.
 */
export function DateSelector({
  basePath,
  date,
  today,
  otherParams,
}: {
  basePath: string;
  date: string;
  today: string;
  otherParams: Record<string, string | undefined>;
}) {
  function hrefFor(targetDate: string): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(otherParams)) {
      if (value) params.set(key, value);
    }
    params.set("date", targetDate);
    // Changing the date starts back at page 1 — a page number from a different date's result set
    // isn't meaningful.
    params.delete("page");
    return `${basePath}?${params.toString()}`;
  }

  function handleDateChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    if (value) window.location.href = hrefFor(value);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Attendance — {formatDateLabel(date)}</h2>
      </div>
      <div className="flex items-center gap-2">
        <Link href={hrefFor(addDays(date, -1))}>
          <Button variant="secondary" size="sm">
            ← Previous
          </Button>
        </Link>
        {date < today ? (
          <Link href={hrefFor(addDays(date, 1))}>
            <Button variant="secondary" size="sm">
              Next →
            </Button>
          </Link>
        ) : (
          <Button variant="secondary" size="sm" disabled title="Attendance is not available for future dates">
            Next →
          </Button>
        )}
        {date !== today && (
          <Link href={hrefFor(today)}>
            <Button variant="secondary" size="sm">
              Today
            </Button>
          </Link>
        )}
        <Input type="date" value={date} max={today} onChange={handleDateChange} aria-label="Select attendance date" className="w-40" />
      </div>
    </div>
  );
}
