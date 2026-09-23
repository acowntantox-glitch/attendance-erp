/**
 * Timezone-aware date/time helpers shared by the Workforce domain and (later) Attendance.
 * Deliberately dependency-free: Node's built-in `Intl` (backed by the ICU/IANA tz database) is
 * enough to do correct, DST-aware wall-clock <-> UTC conversion — `timeZoneName: "longOffset"`
 * gives the exact UTC offset for any instant in any IANA zone, which is all the arithmetic below
 * needs. Verified against a DST-observing zone (America/New_York: GMT-04:00 in July, GMT-05:00
 * in January) before deciding not to add a date library for this.
 *
 * Every wall-clock value in the Workforce schema (schedule/shift start/end, holiday dates) is a
 * clock reading, not an instant — these helpers are what turns "09:00 in Asia/Dubai on
 * 2026-09-23" into an actual point in time, or vice versa.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function parseOffsetToMinutes(offset: string): number {
  // Intl's "longOffset" renders as "GMT", "GMT+4", "GMT+04:00", or "GMT-05:00".
  const match = offset.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;
  const [, sign, hours, minutes = "0"] = match;
  const total = Number(hours) * 60 + Number(minutes);
  return sign === "-" ? -total : total;
}

/** Minutes such that `localWallClock = utcInstant + offset`. */
export function getUtcOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(instant);
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  return parseOffsetToMinutes(offsetPart);
}

/**
 * Converts a wall-clock date + time in `timeZone` to the UTC instant it represents. Two-pass:
 * guess the offset from a naive UTC interpretation, apply it, then re-check the offset at the
 * resulting instant in case the guess crossed a DST transition boundary. Two passes always
 * converge because real-world DST shifts are at least 30 minutes, never large enough to need a
 * third iteration.
 */
export function zonedWallTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [year = 0, month = 1, day = 1] = dateStr.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = timeStr.split(":").map(Number);
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);

  const firstOffset = getUtcOffsetMinutes(new Date(naiveUtcMs), timeZone);
  const candidateMs = naiveUtcMs - firstOffset * 60_000;
  const secondOffset = getUtcOffsetMinutes(new Date(candidateMs), timeZone);
  return new Date(naiveUtcMs - secondOffset * 60_000);
}

/** Inverse of `zonedWallTimeToUtc` — the wall-clock date/time an instant reads as in `timeZone`. */
export function utcToZonedWallTime(instant: Date, timeZone: string): { date: string; time: string } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

/** 0 (Sunday) - 6 (Saturday), for the calendar date as read in `timeZone`. */
export function dayOfWeekInZone(instant: Date, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(instant);
  return WEEKDAY_INDEX[weekday] ?? 0;
}

/** Adds `days` (may be negative) to a plain `YYYY-MM-DD` calendar date, no timezone involved. */
export function addDays(dateStr: string, days: number): string {
  const [year = 0, month = 1, day = 1] = dateStr.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return result.toISOString().slice(0, 10);
}

/** Every `YYYY-MM-DD` date from `from` to `to` inclusive. Empty if `to` is before `from`. */
export function enumerateDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/** First non-empty timezone in the resolution chain (schedule -> branch -> company). */
export function resolveTimezone(...candidates: (string | null | undefined)[]): string {
  const found = candidates.find((tz): tz is string => Boolean(tz && tz.trim().length > 0));
  if (!found) throw new Error("No timezone could be resolved — company.timezone should always be set.");
  return found;
}

/**
 * `endTime <= startTime` means the shift/schedule crosses midnight — a valid, expected shape
 * (e.g. Night 22:00 -> 06:00), never an error. Never store this as a column; always derive it
 * from the current start/end so it can't drift out of sync.
 */
export function spansMidnight(startTime: string, endTime: string): boolean {
  return endTime <= startTime;
}

export type ExpectedWindow = {
  start: { date: string; time: string };
  end: { date: string; time: string };
  spansMidnight: boolean;
};

/**
 * Given the calendar date a shift/schedule *starts* on plus its wall-clock start/end times,
 * returns the (date, time) pair for both boundaries — attributing the end to the next calendar
 * day when the window crosses midnight. Matches the rule already documented in
 * docs/architecture/attendance-architecture.md: "a shift crossing midnight is associated with
 * the day it starts."
 */
export function computeExpectedWindow(date: string, startTime: string, endTime: string): ExpectedWindow {
  const crosses = spansMidnight(startTime, endTime);
  return {
    start: { date, time: startTime },
    end: { date: crosses ? addDays(date, 1) : date, time: endTime },
    spansMidnight: crosses,
  };
}
