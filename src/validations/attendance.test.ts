import { describe, expect, it } from "vitest";
import { daysBetween, isValidIsoDate } from "@/lib/datetime";
import {
  ATTENDANCE_REPORT_MAX_RANGE_DAYS,
  attendanceActionSchema,
  attendanceExceptionFiltersSchema,
  attendanceReportFiltersSchema,
  dateSchema,
  processAttendanceDaySchema,
  requestCorrectionSchema,
  validateDateRange,
} from "./attendance";

describe("isValidIsoDate / daysBetween (F-07, F-08)", () => {
  it("accepts real calendar dates, including a leap day", () => {
    expect(isValidIsoDate("2026-07-21")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
  });

  it("rejects dates a regex lets through and years outside 1900-2100", () => {
    for (const bad of ["2026-02-31", "2027-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "9999-12-31", "0001-01-01", "1899-12-31", "2101-01-01", "2026-7-1", "", "2026-07-21T00:00"]) {
      expect(isValidIsoDate(bad)).toBe(false);
    }
  });

  it("counts days by arithmetic (negative when reversed, 0 for the same day)", () => {
    expect(daysBetween("2026-07-21", "2026-07-21")).toBe(0);
    expect(daysBetween("2026-07-21", "2026-07-22")).toBe(1);
    expect(daysBetween("2026-07-22", "2026-07-21")).toBe(-1);
    expect(daysBetween("2028-01-01", "2028-12-31")).toBe(365); // leap year: 366 days inclusive
  });
});

describe("dateSchema (F-07)", () => {
  it("accepts a real date and rejects malformed and impossible ones", () => {
    expect(dateSchema.safeParse("2026-07-21").success).toBe(true);
    expect(dateSchema.safeParse("21-07-2026").success).toBe(false);
    expect(dateSchema.safeParse("2026-02-31").success).toBe(false);
    expect(dateSchema.safeParse("").success).toBe(false);
    expect(dateSchema.safeParse(undefined).success).toBe(false);
  });

  it("is what the write-side schemas use: an impossible workDate is refused before any service runs", () => {
    expect(processAttendanceDaySchema.safeParse({ workDate: "2026-02-30" }).success).toBe(false);
    expect(processAttendanceDaySchema.safeParse({ workDate: "2026-02-27" }).success).toBe(true);
    expect(
      requestCorrectionSchema.safeParse({ workDate: "2026-13-01", fieldChanged: "CHECK_OUT", correctedValue: "2026-07-21T18:00:00Z", reason: "x" }).success,
    ).toBe(false);
  });

  it("a punch body cannot carry a date: unknown keys such as workDate/occurredAt are stripped, so the server clock decides", () => {
    const parsed = attendanceActionSchema.parse({ idempotencyKey: crypto.randomUUID(), workDate: "2099-01-01", occurredAt: "2099-01-01T09:00:00Z" });
    expect(parsed).not.toHaveProperty("workDate");
    expect(parsed).not.toHaveProperty("occurredAt");
  });
});

describe("report / exception date ranges (F-08)", () => {
  const base = { search: undefined };
  const reportOk = (fromDate: string, toDate: string) => attendanceReportFiltersSchema.safeParse({ ...base, fromDate, toDate }).success;
  const exceptionsOk = (fromDate: string, toDate: string) => attendanceExceptionFiltersSchema.safeParse({ ...base, fromDate, toDate }).success;

  it.each([
    ["a valid range", "2026-07-01", "2026-07-31", true],
    ["a same-day range", "2026-07-21", "2026-07-21", true],
    ["a reversed range", "2026-07-31", "2026-07-01", false],
    ["a malformed from date", "2026-7-1", "2026-07-31", false],
    ["an impossible to date", "2026-07-01", "2026-02-31", false],
  ])("%s", (_name, from, to, expected) => {
    expect(reportOk(from, to)).toBe(expected);
    expect(exceptionsOk(from, to)).toBe(expected);
  });

  it("requires both boundaries (missing dates are rejected, never defaulted into an open-ended query)", () => {
    expect(attendanceReportFiltersSchema.safeParse({ fromDate: "2026-07-01" }).success).toBe(false);
    expect(attendanceReportFiltersSchema.safeParse({ toDate: "2026-07-01" }).success).toBe(false);
    expect(attendanceExceptionFiltersSchema.safeParse({}).success).toBe(false);
  });

  it("allows a large but valid range up to the cap (inclusive), and rejects one day more", () => {
    expect(ATTENDANCE_REPORT_MAX_RANGE_DAYS).toBe(366);
    expect(reportOk("2028-01-01", "2028-12-31")).toBe(true); // 366 days in a leap year
    expect(exceptionsOk("2028-01-01", "2028-12-31")).toBe(true);
    expect(reportOk("2028-01-01", "2029-01-01")).toBe(false); // 367
    expect(exceptionsOk("2028-01-01", "2029-01-01")).toBe(false);
  });

  it("rejects an absurdly wide range immediately (arithmetic, not enumeration)", () => {
    const started = performance.now();
    expect(reportOk("1900-01-01", "2100-12-31")).toBe(false);
    expect(exceptionsOk("1900-01-01", "2100-12-31")).toBe(false);
    expect(reportOk("0001-01-01", "9999-12-31")).toBe(false); // out-of-range years: rejected by dateSchema first
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("does not forbid a future range (it just matches nothing): a future-dated report is not an error", () => {
    expect(reportOk("2030-01-01", "2030-01-31")).toBe(true);
  });

  it("validateDateRange covers the same rules for plain query params", () => {
    expect(validateDateRange("2026-07-01", "2026-07-31")).toBeNull();
    expect(validateDateRange("2026-07-21", "2026-07-21")).toBeNull();
    expect(validateDateRange("2026-07-31", "2026-07-01")).toMatch(/on or before/);
    expect(validateDateRange("2026-02-31", "2026-07-01")).toMatch(/real dates/);
    expect(validateDateRange("2028-01-01", "2029-01-01")).toMatch(/cannot exceed 366/);
    expect(validateDateRange("2028-01-01", "2028-12-31")).toBeNull();
  });
});
