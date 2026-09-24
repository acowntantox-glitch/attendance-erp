import { describe, expect, it } from "vitest";
import { STATUS_SHORT_LABEL, formatMonthLabel, formatWeekdayShort, isWeekendDate } from "../format";

describe("STATUS_SHORT_LABEL (§35 data integrity)", () => {
  it.each([
    ["PRESENT", "P"],
    ["LATE", "L"],
    ["ABSENT", "A"],
    ["INCOMPLETE", "I"],
    ["WEEKLY_OFF", "WO"],
    ["HOLIDAY", "H"],
    ["NO_SCHEDULE", "NS"],
  ] as const)("%s renders %s", (status, short) => {
    expect(STATUS_SHORT_LABEL[status]).toBe(short);
  });

  it("keeps WEEKLY_OFF_WORKED and HOLIDAY_WORKED visually distinct from their non-worked counterparts", () => {
    expect(STATUS_SHORT_LABEL.WEEKLY_OFF_WORKED).not.toBe(STATUS_SHORT_LABEL.WEEKLY_OFF);
    expect(STATUS_SHORT_LABEL.HOLIDAY_WORKED).not.toBe(STATUS_SHORT_LABEL.HOLIDAY);
  });
});

describe("formatWeekdayShort", () => {
  it("labels a known date correctly", () => {
    // 2026-09-24 is a Thursday.
    expect(formatWeekdayShort("2026-09-24")).toBe("Thu");
    // 2027-04-01 is a Thursday.
    expect(formatWeekdayShort("2027-04-01")).toBe("Thu");
  });
});

describe("isWeekendDate", () => {
  it("identifies Saturday/Sunday, and nothing else", () => {
    expect(isWeekendDate("2026-09-26")).toBe(true); // Saturday
    expect(isWeekendDate("2026-09-27")).toBe(true); // Sunday
    expect(isWeekendDate("2026-09-24")).toBe(false); // Thursday
  });
});

describe("formatMonthLabel", () => {
  it("formats a YYYY-MM month", () => {
    expect(formatMonthLabel("2026-09")).toBe("September 2026");
    expect(formatMonthLabel("2027-01")).toBe("January 2027");
  });
});
