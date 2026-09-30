/**
 * Batch 13 — which work dates are safe to process. Pure and deterministic (no I/O, no clock read):
 * `now` is a parameter.
 *
 * RULE: a work date D is DUE once
 *
 *     now >= max(  end of calendar day D in every timezone the company operates in,
 *                  end of every active shift/schedule window that starts on D, in every such timezone )
 *              + processingLag
 *
 * where "end of calendar day D" is 00:00 of D+1 in that timezone, and a window that crosses
 * midnight (e.g. 22:00 -> 06:00) ends on D+1. Taking the maximum over ALL of the company's
 * timezones means a date is never processed while it is still D anywhere the company operates, and
 * taking the latest window end means an overnight shift that began on D is finished (plus the lag)
 * before D is considered complete. DST is handled by `zonedWallTimeToUtc`, which resolves each
 * wall-clock boundary to the correct UTC instant for that specific date.
 *
 * Of the dates that are due, only the most recent `lookbackDays` are returned (oldest first), so a
 * few missed scheduler invocations are caught up without any unbounded historical backfill.
 *
 * KNOWN LIMITATION (documented, deliberate): the rule is company-wide, not per employee. It is
 * conservative — it can only delay processing (late) never advance it (premature ABSENT) — and it
 * cannot see a session that runs past the latest configured shift end; such a session simply shows
 * up as INCOMPLETE, and is later overwritten by its own check-out recalculation.
 */
import { addDays, spansMidnight, zonedWallTimeToUtc } from "@/lib/datetime";

const MS_PER_MINUTE = 60_000;

export type ShiftWindow = { startTime: string; endTime: string };

export type DueDateInput = {
  now: Date;
  /** Every IANA timezone the company operates in (company + active branches + active schedules). */
  timezones: string[];
  /** Start/end wall-clock times of every active shift and work schedule. */
  windows: ShiftWindow[];
  lagMinutes: number;
  lookbackDays: number;
};

/** The instant at which `workDate` becomes eligible for processing (inclusive), lag included. */
export function workDateDueAt(workDate: string, timezones: string[], windows: ShiftWindow[], lagMinutes: number): Date {
  const nextDay = addDays(workDate, 1);
  let latest = 0;

  for (const timezone of timezones) {
    latest = Math.max(latest, zonedWallTimeToUtc(nextDay, "00:00:00", timezone).getTime());
    for (const window of windows) {
      const endDate = spansMidnight(window.startTime, window.endTime) ? nextDay : workDate;
      latest = Math.max(latest, zonedWallTimeToUtc(endDate, window.endTime, timezone).getTime());
    }
  }

  return new Date(latest + lagMinutes * MS_PER_MINUTE);
}

export function computeDueWorkDates(input: DueDateInput): string[] {
  const { now, timezones, windows, lagMinutes, lookbackDays } = input;
  if (timezones.length === 0 || lookbackDays < 1) return [];

  // Timezones span UTC-12..UTC+14 and the lag is at most a day, so the newest due date is never
  // newer than yesterday-in-UTC-ish and never older than (today - 3); scanning from
  // (lookbackDays + 3) days back therefore always sees at least `lookbackDays` due dates.
  const utcToday = now.toISOString().slice(0, 10);
  const due: string[] = [];
  for (let offset = lookbackDays + 3; offset >= -1; offset--) {
    const candidate = addDays(utcToday, -offset);
    if (workDateDueAt(candidate, timezones, windows, lagMinutes).getTime() <= now.getTime()) due.push(candidate);
  }

  return due.slice(-lookbackDays);
}
