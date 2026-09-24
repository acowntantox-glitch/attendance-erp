import { z } from "zod";
import { enumerateDateRange } from "@/lib/datetime";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be in YYYY-MM format");

const attendanceDailyStatusValues = [
  "PRESENT",
  "LATE",
  "ABSENT",
  "INCOMPLETE",
  "WEEKLY_OFF",
  "HOLIDAY",
  "WEEKLY_OFF_WORKED",
  "HOLIDAY_WORKED",
  "NO_SCHEDULE",
] as const;

export const attendanceActionSchema = z.object({
  idempotencyKey: z.uuid().optional(),
  sourceMetadata: z.record(z.string(), z.unknown()).optional(),
});

export const requestCorrectionSchema = z.object({
  workDate: dateSchema,
  fieldChanged: z.enum(["CHECK_IN", "CHECK_OUT", "BREAK_START", "BREAK_END"]),
  eventId: z.uuid().optional(),
  // Requires an explicit UTC offset (e.g. "2026-09-24T09:00:00Z") so the corrected instant is
  // never silently reinterpreted against the server's own timezone.
  correctedValue: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  reason: z.string().min(1).max(2000),
});

export const reviewCorrectionSchema = z.object({
  reviewNote: z.string().max(2000).optional(),
});

export const processAttendanceDaySchema = z.object({
  workDate: dateSchema,
  employeeId: z.uuid().optional(),
});

/** §8 — an explicit server-side cap on how much history one report query can span. No existing
 *  reporting range limit was found elsewhere in the project, so this batch introduces one, made
 *  explicit here rather than silently truncated. */
export const ATTENDANCE_REPORT_MAX_RANGE_DAYS = 366;

export const attendanceReportFiltersSchema = z
  .object({
    fromDate: dateSchema,
    toDate: dateSchema,
    employeeId: z.uuid().optional(),
    departmentId: z.uuid().optional(),
    locationId: z.uuid().optional(),
    status: z.enum(attendanceDailyStatusValues).optional(),
    search: z.string().max(200).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).optional(),
  })
  .refine((data) => data.fromDate <= data.toDate, { message: "'fromDate' must be on or before 'toDate'.", path: ["toDate"] })
  .refine((data) => enumerateDateRange(data.fromDate, data.toDate).length <= ATTENDANCE_REPORT_MAX_RANGE_DAYS, {
    message: `The date range cannot exceed ${ATTENDANCE_REPORT_MAX_RANGE_DAYS} days.`,
    path: ["toDate"],
  });

/**
 * Batch 7 monthly calendar. No `status` filter (§9) — a matrix shows every day at once, so "only
 * PRESENT rows" has no clean, unambiguous meaning the way it does for Batch 6's flat report; the
 * batch's own spec explicitly permits omitting a filter that would "materially complicate the
 * query or UX" rather than inventing one.
 */
export const attendanceCalendarFiltersSchema = z.object({
  month: monthSchema,
  search: z.string().max(200).optional(),
  departmentId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).optional(),
});

export type AttendanceActionInput = z.infer<typeof attendanceActionSchema>;
export type RequestCorrectionInput = z.infer<typeof requestCorrectionSchema>;
export type ReviewCorrectionInput = z.infer<typeof reviewCorrectionSchema>;
export type ProcessAttendanceDayInput = z.infer<typeof processAttendanceDaySchema>;
export type AttendanceReportFiltersInput = z.infer<typeof attendanceReportFiltersSchema>;
export type AttendanceCalendarFiltersInput = z.infer<typeof attendanceCalendarFiltersSchema>;
