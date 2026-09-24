"use client";

import Link from "next/link";
import type { ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMonthLabel } from "../format";

/**
 * Pure URL-navigation, same convention as the dashboard's `DateSelector` — every control here
 * only ever builds a link/navigates by changing the `month` query param and letting the Server
 * Component re-fetch; nothing computes "the previous month" on the client beyond simple string
 * arithmetic already mirrored from the service's own `shiftMonth`.
 */
export function CalendarMonthNav({
  basePath,
  month,
  prevMonth,
  nextMonth,
  otherParams,
}: {
  basePath: string;
  month: string;
  prevMonth: string;
  nextMonth: string;
  otherParams: Record<string, string | undefined>;
}) {
  function hrefFor(targetMonth: string): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(otherParams)) {
      if (value) params.set(key, value);
    }
    params.set("month", targetMonth);
    params.delete("page"); // a different month's employee list starts back at page 1
    return `${basePath}?${params.toString()}`;
  }

  function handleMonthChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    if (value) window.location.href = hrefFor(value);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-base font-semibold text-slate-900">{formatMonthLabel(month)}</h2>
      <div className="flex items-center gap-2">
        <Link href={hrefFor(prevMonth)}>
          <Button variant="secondary" size="sm">
            ← Previous Month
          </Button>
        </Link>
        <Link href={hrefFor(nextMonth)}>
          <Button variant="secondary" size="sm">
            Next Month →
          </Button>
        </Link>
        <Input type="month" value={month} onChange={handleMonthChange} aria-label="Select month" className="w-40" />
      </div>
    </div>
  );
}
