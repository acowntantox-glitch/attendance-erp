import { describe, expect, it } from "vitest";
import {
  addDays,
  computeExpectedWindow,
  dayOfWeekInZone,
  enumerateDateRange,
  getUtcOffsetMinutes,
  resolveTimezone,
  spansMidnight,
  utcToZonedWallTime,
  zonedWallTimeToUtc,
} from "./index";

describe("getUtcOffsetMinutes", () => {
  it("returns the fixed UAE offset (no DST)", () => {
    expect(getUtcOffsetMinutes(new Date("2026-01-15T00:00:00Z"), "Asia/Dubai")).toBe(240);
    expect(getUtcOffsetMinutes(new Date("2026-07-15T00:00:00Z"), "Asia/Dubai")).toBe(240);
  });

  it("reflects a DST transition in a zone that observes it", () => {
    expect(getUtcOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe(-300);
    expect(getUtcOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "America/New_York")).toBe(-240);
  });
});

describe("zonedWallTimeToUtc / utcToZonedWallTime round-trip", () => {
  it("round-trips a UAE wall-clock time", () => {
    const instant = zonedWallTimeToUtc("2026-09-23", "09:00:00", "Asia/Dubai");
    expect(instant.toISOString()).toBe("2026-09-23T05:00:00.000Z");
    expect(utcToZonedWallTime(instant, "Asia/Dubai")).toEqual({ date: "2026-09-23", time: "09:00:00" });
  });

  it("round-trips across a DST spring-forward transition", () => {
    // 2026-03-08 is the US spring-forward date; 09:00 local before it is UTC-5, same wall clock
    // just after is UTC-4 — the two-pass conversion must land on the correct instant either way.
    const before = zonedWallTimeToUtc("2026-03-07", "09:00:00", "America/New_York");
    const after = zonedWallTimeToUtc("2026-03-09", "09:00:00", "America/New_York");
    expect(utcToZonedWallTime(before, "America/New_York")).toEqual({ date: "2026-03-07", time: "09:00:00" });
    expect(utcToZonedWallTime(after, "America/New_York")).toEqual({ date: "2026-03-09", time: "09:00:00" });
    expect(before.getUTCHours()).toBe(14); // UTC-5
    expect(after.getUTCHours()).toBe(13); // UTC-4
  });

  it("round-trips across a DST fall-back transition", () => {
    // 2026-11-01 is the US fall-back date; 09:00 local before it is UTC-4, same wall clock just
    // after is UTC-5 — the ambiguous-hour case (01:30 occurs twice) isn't exercised here since
    // 09:00 falls outside the repeated hour, but the offset must still flip correctly either side.
    const before = zonedWallTimeToUtc("2026-10-31", "09:00:00", "America/New_York");
    const after = zonedWallTimeToUtc("2026-11-02", "09:00:00", "America/New_York");
    expect(utcToZonedWallTime(before, "America/New_York")).toEqual({ date: "2026-10-31", time: "09:00:00" });
    expect(utcToZonedWallTime(after, "America/New_York")).toEqual({ date: "2026-11-02", time: "09:00:00" });
    expect(before.getUTCHours()).toBe(13); // UTC-4
    expect(after.getUTCHours()).toBe(14); // UTC-5
  });
});

describe("dayOfWeekInZone", () => {
  it("resolves the weekday in the target zone, not UTC's", () => {
    // 2026-09-23T21:30:00Z (Wednesday) is already 2026-09-24T01:30 (Thursday) in Asia/Dubai (+04:00).
    expect(dayOfWeekInZone(new Date("2026-09-23T21:30:00Z"), "Asia/Dubai")).toBe(4);
    expect(dayOfWeekInZone(new Date("2026-09-23T21:30:00Z"), "UTC")).toBe(3);
  });
});

describe("spansMidnight", () => {
  it("treats end <= start as crossing midnight", () => {
    expect(spansMidnight("09:00:00", "17:00:00")).toBe(false);
    expect(spansMidnight("22:00:00", "06:00:00")).toBe(true);
  });

  // 00:00 -> 00:00 has no explicitly agreed meaning in the current architecture (a genuine 24h
  // shift? a zero-duration/unset shift?). The implementation's `endTime <= startTime` rule
  // mechanically classifies it as crossing midnight (a 24h shift), but this is documented here as
  // an open question for product review, not a confirmed intended behavior — see the Phase 3
  // audit report. Do not treat this test as approval of that interpretation; it only pins down
  // what the current code actually does so a future change here is a deliberate, visible diff.
  it("classifies 00:00 -> 00:00 as crossing midnight under the current end<=start rule (flagged, not a confirmed spec)", () => {
    expect(spansMidnight("00:00:00", "00:00:00")).toBe(true);
  });
});

describe("computeExpectedWindow", () => {
  it("keeps a same-day window on the same calendar date", () => {
    expect(computeExpectedWindow("2026-09-23", "09:00:00", "18:00:00")).toEqual({
      start: { date: "2026-09-23", time: "09:00:00" },
      end: { date: "2026-09-23", time: "18:00:00" },
      spansMidnight: false,
    });
  });

  it("attributes a cross-midnight end to the next calendar day", () => {
    expect(computeExpectedWindow("2026-09-23", "22:00:00", "06:00:00")).toEqual({
      start: { date: "2026-09-23", time: "22:00:00" },
      end: { date: "2026-09-24", time: "06:00:00" },
      spansMidnight: true,
    });
  });

  it("handles a plain daytime window (09:00 -> 17:00)", () => {
    expect(computeExpectedWindow("2026-09-23", "09:00:00", "17:00:00")).toEqual({
      start: { date: "2026-09-23", time: "09:00:00" },
      end: { date: "2026-09-23", time: "17:00:00" },
      spansMidnight: false,
    });
  });

  // See the flagged spansMidnight test above — 00:00 -> 00:00's semantics are an open question,
  // this only documents what the current code actually produces.
  it("classifies 00:00 -> 00:00 as a full-day cross-midnight window under the current rule (flagged)", () => {
    expect(computeExpectedWindow("2026-09-23", "00:00:00", "00:00:00")).toEqual({
      start: { date: "2026-09-23", time: "00:00:00" },
      end: { date: "2026-09-24", time: "00:00:00" },
      spansMidnight: true,
    });
  });
});

describe("addDays", () => {
  it("rolls over month and year boundaries", () => {
    expect(addDays("2026-09-23", 1)).toBe("2026-09-24");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("enumerateDateRange", () => {
  it("returns every date inclusive of both endpoints", () => {
    expect(enumerateDateRange("2026-09-28", "2026-10-02")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });

  it("returns a single-element array when from equals to", () => {
    expect(enumerateDateRange("2026-09-23", "2026-09-23")).toEqual(["2026-09-23"]);
  });

  it("returns an empty array when to is before from", () => {
    expect(enumerateDateRange("2026-09-23", "2026-09-20")).toEqual([]);
  });
});

describe("resolveTimezone", () => {
  it("picks the first non-empty candidate", () => {
    expect(resolveTimezone(undefined, "", "Asia/Dubai", "UTC")).toBe("Asia/Dubai");
  });

  it("throws when nothing resolves", () => {
    expect(() => resolveTimezone(undefined, null)).toThrow();
  });
});
