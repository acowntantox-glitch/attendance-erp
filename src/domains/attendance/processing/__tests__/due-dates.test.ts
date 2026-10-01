import { describe, expect, it } from "vitest";
import { computeDueWorkDates, workDateDueAt } from "../due-dates";

const Z = (iso: string) => new Date(iso);

describe("workDateDueAt", () => {
  it("UTC company: a date is due at the next midnight plus the lag", () => {
    expect(workDateDueAt("2026-04-09", ["UTC"], [], 180)).toEqual(Z("2026-04-10T03:00:00Z"));
    expect(workDateDueAt("2026-04-09", ["UTC"], [], 0)).toEqual(Z("2026-04-10T00:00:00Z"));
  });

  it("multiple timezones: waits for the latest-ending one", () => {
    // Dubai (UTC+4) ends 04-10 00:00 = 04-09T20:00Z; Los Angeles (PDT, UTC-7) ends 04-10 00:00 = 04-10T07:00Z.
    expect(workDateDueAt("2026-04-09", ["Asia/Dubai", "America/Los_Angeles"], [], 180)).toEqual(Z("2026-04-10T10:00:00Z"));
    expect(workDateDueAt("2026-04-09", ["Asia/Dubai"], [], 180)).toEqual(Z("2026-04-09T23:00:00Z"));
  });

  it("an overnight shift that starts on the date pushes the due time to its end plus the lag", () => {
    const night = [{ startTime: "22:00:00", endTime: "06:00:00" }];
    // Day ends 04-10T00:00Z, but the shift ends 04-10T06:00Z -> due 09:00Z, not 03:00Z.
    expect(workDateDueAt("2026-04-09", ["UTC"], night, 180)).toEqual(Z("2026-04-10T09:00:00Z"));
  });

  it("a same-day window never delays beyond the end of the calendar day", () => {
    expect(workDateDueAt("2026-04-09", ["UTC"], [{ startTime: "09:00:00", endTime: "18:00:00" }], 180)).toEqual(Z("2026-04-10T03:00:00Z"));
  });

  it("handles a DST transition: the spring-forward day is 23 hours long", () => {
    // America/New_York: EST (UTC-5) until 2026-03-08 02:00, then EDT (UTC-4).
    expect(workDateDueAt("2026-03-07", ["America/New_York"], [], 0)).toEqual(Z("2026-03-08T05:00:00Z"));
    expect(workDateDueAt("2026-03-08", ["America/New_York"], [], 0)).toEqual(Z("2026-03-09T04:00:00Z"));
  });
});

describe("computeDueWorkDates", () => {
  const base = { timezones: ["UTC"], windows: [], lagMinutes: 180, lookbackDays: 3 };

  it("excludes a date that has not yet ended plus the lag", () => {
    expect(computeDueWorkDates({ ...base, now: Z("2026-04-10T02:59:59Z") })).toEqual(["2026-04-06", "2026-04-07", "2026-04-08"]);
  });

  it("includes the date exactly at the boundary (inclusive)", () => {
    expect(computeDueWorkDates({ ...base, now: Z("2026-04-10T03:00:00Z") })).toEqual(["2026-04-07", "2026-04-08", "2026-04-09"]);
  });

  it("never returns today or a future date", () => {
    const dates = computeDueWorkDates({ ...base, lagMinutes: 0, now: Z("2026-04-10T23:59:00Z") });
    expect(dates.every((d) => d <= "2026-04-09")).toBe(true);
    expect(dates).not.toContain("2026-04-10");
    expect(dates).not.toContain("2026-04-11");
  });

  it("returns exactly lookbackDays dates, oldest first, contiguous", () => {
    const dates = computeDueWorkDates({ ...base, lookbackDays: 7, now: Z("2026-04-10T12:00:00Z") });
    expect(dates).toEqual(["2026-04-03", "2026-04-04", "2026-04-05", "2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09"]);
  });

  it("a later-timezone company lags a UTC one at the same instant", () => {
    const now = Z("2026-04-10T06:00:00Z");
    expect(computeDueWorkDates({ ...base, lookbackDays: 1, now })).toEqual(["2026-04-09"]);
    // Los Angeles is still on 04-09 until 07:00Z (+3h lag) -> 04-09 is not yet due there.
    expect(computeDueWorkDates({ ...base, lookbackDays: 1, timezones: ["UTC", "America/Los_Angeles"], now })).toEqual(["2026-04-08"]);
  });

  it("returns nothing without timezones or with a non-positive lookback", () => {
    expect(computeDueWorkDates({ ...base, timezones: [], now: Z("2026-04-10T12:00:00Z") })).toEqual([]);
    expect(computeDueWorkDates({ ...base, lookbackDays: 0, now: Z("2026-04-10T12:00:00Z") })).toEqual([]);
  });
});

describe("F-07 - the scheduled job never materializes a date that has not finished", () => {
  it("for any 'now' and any timezone mix, no due date is today (or later) in ANY of the company's timezones", () => {
    const zones = ["UTC", "Asia/Dubai", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago"];
    for (let hour = 0; hour < 24 * 3; hour += 5) {
      const now = new Date(Date.UTC(2026, 6, 20, 0, 0) + hour * 3_600_000);
      const due = computeDueWorkDates({ now, timezones: zones, windows: [], lagMinutes: 0, lookbackDays: 7 });
      for (const date of due) {
        for (const zone of zones) {
          const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(now); // YYYY-MM-DD
          expect(date < localToday).toBe(true); // strictly before the local calendar day: the day is over there
        }
      }
    }
  });

  it("a date becomes due only after its overnight shift has ended", () => {
    const night = [{ startTime: "22:00:00", endTime: "06:00:00" }];
    const justBefore = computeDueWorkDates({ now: Z("2026-04-10T05:59:00Z"), timezones: ["UTC"], windows: night, lagMinutes: 0, lookbackDays: 1 });
    const after = computeDueWorkDates({ now: Z("2026-04-10T06:01:00Z"), timezones: ["UTC"], windows: night, lagMinutes: 0, lookbackDays: 1 });
    expect(justBefore).not.toContain("2026-04-09");
    expect(after).toContain("2026-04-09");
  });
});
