import { describe, expect, it } from "vitest";
import { buildWeeks, formatMonthLabel, formatMonthParam, getGridRange, isInMonth, parseMonthParam, shiftMonth } from "./calendar-month";

describe("parseMonthParam", () => {
  it("parses a valid YYYY-MM param", () => {
    expect(parseMonthParam("2026-09")).toEqual({ year: 2026, month: 9 });
  });

  it("falls back to the current month for missing or invalid input", () => {
    const now = new Date();
    const expected = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
    expect(parseMonthParam(undefined)).toEqual(expected);
    expect(parseMonthParam("not-a-month")).toEqual(expected);
    expect(parseMonthParam("2026-13")).toEqual(expected);
  });
});

describe("formatMonthParam / formatMonthLabel", () => {
  it("round-trips and labels correctly", () => {
    expect(formatMonthParam(2026, 9)).toBe("2026-09");
    expect(formatMonthLabel(2026, 9)).toBe("September 2026");
  });
});

describe("shiftMonth", () => {
  it("moves forward and backward within a year", () => {
    expect(shiftMonth(2026, 9, 1)).toEqual({ year: 2026, month: 10 });
    expect(shiftMonth(2026, 9, -1)).toEqual({ year: 2026, month: 8 });
  });

  it("rolls over year boundaries in both directions", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe("getGridRange", () => {
  it("pads to full Sunday-Saturday weeks around the month", () => {
    // 2026-09-01 is a Tuesday; 2026-09-30 is a Wednesday.
    const { from, to } = getGridRange(2026, 9);
    expect(from).toBe("2026-08-30"); // preceding Sunday
    expect(to).toBe("2026-10-03"); // following Saturday
  });

  it("produces a range whose day count is a multiple of 7", () => {
    for (const [year, month] of [
      [2026, 1],
      [2026, 2],
      [2024, 2], // leap year February
      [2026, 12],
    ]) {
      const { from, to } = getGridRange(year!, month!);
      const days = buildWeeks(from, to).flat().length;
      expect(days % 7).toBe(0);
      expect(days).toBeLessThanOrEqual(42);
    }
  });
});

describe("buildWeeks", () => {
  it("chunks a padded range into weeks of 7", () => {
    const { from, to } = getGridRange(2026, 9);
    const weeks = buildWeeks(from, to);
    for (const week of weeks) {
      expect(week).toHaveLength(7);
    }
    expect(weeks[0]![0]).toBe(from);
    expect(weeks.at(-1)!.at(-1)).toBe(to);
  });
});

describe("isInMonth", () => {
  it("distinguishes padding days from the actual month", () => {
    expect(isInMonth("2026-09-01", 2026, 9)).toBe(true);
    expect(isInMonth("2026-09-30", 2026, 9)).toBe(true);
    expect(isInMonth("2026-08-30", 2026, 9)).toBe(false);
    expect(isInMonth("2026-10-03", 2026, 9)).toBe(false);
  });
});
