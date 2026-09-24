import type { AttendanceCorrectionField } from "@/domains/attendance/model";
import type { AttendanceDailyStatus } from "@/domains/attendance/model";

/**
 * Every helper here formats a value the backend already computed — none of them derive, sum, or
 * reinterpret a business figure. `null` always means "not available" and must never be displayed
 * as a fake zero.
 */

export const STATUS_LABEL: Record<AttendanceDailyStatus, string> = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
  INCOMPLETE: "Incomplete",
  WEEKLY_OFF: "Weekly Off",
  HOLIDAY: "Holiday",
  WEEKLY_OFF_WORKED: "Worked on Weekly Off",
  HOLIDAY_WORKED: "Worked on Holiday",
  NO_SCHEDULE: "No Schedule",
};

/** Compact 1-3 character glyphs for narrow matrix cells (Batch 7 monthly calendar) — every one of
 *  these is always paired with a full accessible label/tooltip built from `STATUS_LABEL` above,
 *  never shown as the only signal. `WEEKLY_OFF_WORKED`/`HOLIDAY_WORKED` stay visually distinct
 *  from `WEEKLY_OFF`/`HOLIDAY` (never collapsed into them), matching the existing daily-status
 *  enum's own distinction. */
export const STATUS_SHORT_LABEL: Record<AttendanceDailyStatus, string> = {
  PRESENT: "P",
  LATE: "L",
  ABSENT: "A",
  INCOMPLETE: "I",
  WEEKLY_OFF: "WO",
  HOLIDAY: "H",
  WEEKLY_OFF_WORKED: "W",
  HOLIDAY_WORKED: "H/W",
  NO_SCHEDULE: "NS",
};

const NOT_AVAILABLE = "Not available";

/** Minutes -> "Xh Ym" (or "Ym" under an hour). Never called with a fabricated 0 — callers must
 *  pass `null` through untouched (see `formatMinutesOrNull`). */
function formatMinutesValue(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function formatMinutesOrNull(minutes: number | null, unavailableLabel = NOT_AVAILABLE): string {
  return minutes === null ? unavailableLabel : formatMinutesValue(minutes);
}

/** An instant (Date or ISO string) formatted in `timeZone`, or `unavailableLabel` for
 *  null/undefined — never substitutes the browser's local time zone for a missing server-resolved
 *  one. Defaults to "Not available" (the spacious self-service card convention); dense tables pass
 *  "—" to match the existing employee-directory-table convention. */
export function formatInstant(
  value: Date | string | null | undefined,
  timeZone: string | null | undefined,
  unavailableLabel = NOT_AVAILABLE,
): string {
  if (!value || !timeZone) return unavailableLabel;
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export const CORRECTION_FIELD_LABEL: Record<AttendanceCorrectionField, string> = {
  CHECK_IN: "Check-in",
  CHECK_OUT: "Check-out",
  BREAK_START: "Break start",
  BREAK_END: "Break end",
};

/** A full instant (date + time) formatted in `timeZone`, unlike `formatInstant` which shows time
 *  only — used for correction values, which may fall on a different calendar day than the work
 *  date being corrected (an overnight shift's missing checkout, for instance). */
export function formatInstantWithDate(
  value: Date | string | null | undefined,
  timeZone: string | null | undefined,
  unavailableLabel = NOT_AVAILABLE,
): string {
  if (!value || !timeZone) return unavailableLabel;
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatDateLabel(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  if (!year || !month || !day) return dateIso;
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
}

/** Short weekday label ("Mon", "Tue", ...) for a plain `YYYY-MM-DD` calendar date — the monthly
 *  calendar's day-column header (Batch 7). Same noon-UTC-anchoring as `formatDateLabel` above, so
 *  there is no DST/timezone edge to worry about; this labels the calendar date itself, not an
 *  employee-specific instant. */
export function formatWeekdayShort(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

/** Saturday/Sunday, for the calendar's purely visual weekend styling — never a substitute for the
 *  real `WEEKLY_OFF` status, which always comes from the employee's actual daily record (§11). */
export function isWeekendDate(dateIso: string): boolean {
  const [year, month, day] = dateIso.split("-").map(Number);
  if (!year || !month || !day) return false;
  const dow = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return dow === 0 || dow === 6;
}

/** "September 2026" for a `YYYY-MM` month string — the calendar page's month heading. */
export function formatMonthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  if (!year || !mon) return month;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(Date.UTC(year, mon - 1, 1, 12)));
}

export { NOT_AVAILABLE };
