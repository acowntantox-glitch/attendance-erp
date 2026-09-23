import { addDays, enumerateDateRange } from "@/lib/datetime";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Pure calendar-date arithmetic for laying out a month grid — this is NOT the same concern as
 * `dayOfWeekInZone` in src/lib/datetime (which resolves the weekday for a specific instant in a
 * specific employee's timezone, for weekly-off business logic). Which grid column a calendar
 * *date* like "2026-09-01" belongs to is a fixed calendar fact independent of any employee's
 * timezone, so no zoned conversion belongs here.
 */
function dayOfWeekForDate(dateStr: string): number {
  const [year = 0, month = 1, day = 1] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function parseMonthParam(month: string | undefined): { year: number; month: number } {
  const match = month?.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const monthNum = Number(match[2]);
    if (monthNum >= 1 && monthNum <= 12) return { year, month: monthNum };
  }
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export function formatMonthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (((total % 12) + 12) % 12) + 1 };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The date range to fetch: the month itself, padded out to full Sunday-Saturday weeks. */
export function getGridRange(year: number, month: number): { from: string; to: string } {
  const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastOfMonth = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`;

  const leadingPad = dayOfWeekForDate(firstOfMonth); // 0 (Sun) needs no padding, 6 (Sat) needs 6 days back
  const from = addDays(firstOfMonth, -leadingPad);

  const trailingPad = 6 - dayOfWeekForDate(lastOfMonth);
  const to = addDays(lastOfMonth, trailingPad);

  return { from, to };
}

/** Chunks a full [from, to] padded range into weeks of 7 for grid rendering. */
export function buildWeeks(from: string, to: string): string[][] {
  const dates = enumerateDateRange(from, to);
  const weeks: string[][] = [];
  for (let i = 0; i < dates.length; i += 7) {
    weeks.push(dates.slice(i, i + 7));
  }
  return weeks;
}

export function isInMonth(dateStr: string, year: number, month: number): boolean {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  return dateStr.startsWith(prefix);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
