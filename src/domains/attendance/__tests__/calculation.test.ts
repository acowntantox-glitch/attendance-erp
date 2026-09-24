import { describe, expect, it } from "vitest";
import { applyCorrectionsToSessions, calculateDailyAttendance, normalizeExpectationPeriods } from "../calculation";
import type { AttendanceCorrectionOverride, AttendanceSessionInput, DailyWorkforceContext } from "../model";

const D = (t: string) => new Date(`2026-09-23T${t}:00Z`);

function session(overrides: Partial<AttendanceSessionInput>): AttendanceSessionInput {
  return {
    sessionId: "s",
    checkInAt: D("09:00"),
    checkOutAt: D("18:00"),
    status: "CLOSED",
    isHoliday: false,
    isWeeklyOff: false,
    isWorkingDay: true,
    expectedStartAt: D("09:00"),
    expectedEndAt: D("18:00"),
    gracePeriodMinutes: 0,
    breaks: [],
    ...overrides,
  };
}

const workingDayContext: DailyWorkforceContext = {
  isHoliday: false,
  isWeeklyOff: false,
  isWorkingDay: true,
  expectedStartAt: D("09:00"),
  expectedEndAt: D("18:00"),
  gracePeriodMinutes: 0,
};

describe("normalizeExpectationPeriods", () => {
  it("Case 1: the same schedule captured by two sessions counts its window exactly once", () => {
    const sessions = [
      session({ sessionId: "1", checkInAt: D("09:00"), checkOutAt: D("12:00") }),
      session({ sessionId: "2", checkInAt: D("14:00"), checkOutAt: D("19:00") }),
    ];
    const periods = normalizeExpectationPeriods(sessions);
    expect(periods).toHaveLength(1);
    expect(periods[0]!.expectedStart).toEqual(D("09:00"));
    expect(periods[0]!.operativeEnd).toEqual(D("18:00"));
  });

  it("Case 2: a genuinely overlapping later snapshot truncates the earlier one at the later session's own check-in", () => {
    const sessions = [
      session({ sessionId: "1", checkInAt: D("09:00"), checkOutAt: D("14:00"), expectedStartAt: D("09:00"), expectedEndAt: D("18:00") }),
      session({ sessionId: "2", checkInAt: D("14:00"), checkOutAt: D("18:00"), expectedStartAt: D("14:00"), expectedEndAt: D("22:00") }),
    ];
    const periods = normalizeExpectationPeriods(sessions);
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({ expectedStart: D("09:00"), expectedEnd: D("18:00"), operativeEnd: D("14:00") });
    expect(periods[1]).toMatchObject({ expectedStart: D("14:00"), expectedEnd: D("22:00"), operativeEnd: D("22:00") });
  });

  it("Case 4: an explicit check-out/check-in at the second schedule's boundary produces a clean split with no overlap", () => {
    const sessions = [
      session({ sessionId: "1", checkInAt: D("09:00"), checkOutAt: D("16:00"), expectedStartAt: D("09:00"), expectedEndAt: D("18:00") }),
      session({ sessionId: "2", checkInAt: D("16:00"), checkOutAt: D("22:00"), expectedStartAt: D("16:00"), expectedEndAt: D("22:00") }),
    ];
    const periods = normalizeExpectationPeriods(sessions);
    expect(periods[0]).toMatchObject({ operativeEnd: D("16:00") });
    expect(periods.reduce((sum, p) => sum + (p.operativeEnd.getTime() - p.expectedStart.getTime()) / 60000, 0)).toBe(780);
  });

  it("Case 8: operative duration never goes negative even if a later snapshot's check-in precedes the earlier snapshot's own start", () => {
    const sessions = [
      session({ sessionId: "1", checkInAt: D("09:00"), checkOutAt: D("10:00"), expectedStartAt: D("09:00"), expectedEndAt: D("18:00") }),
      // Pathological: the next distinct snapshot was first captured before period 1's own expectedStart.
      session({ sessionId: "2", checkInAt: D("08:00"), checkOutAt: D("09:00"), expectedStartAt: D("08:00"), expectedEndAt: D("20:00") }),
    ];
    const periods = normalizeExpectationPeriods(sessions);
    expect(periods[0]!.operativeEnd.getTime()).toBeGreaterThanOrEqual(periods[0]!.expectedStart.getTime());
  });
});

describe("calculateDailyAttendance", () => {
  it("Case 1: same schedule, two sessions — scheduled counted once, no overtime, no late/early", () => {
    const sessions = [
      session({ sessionId: "1", checkInAt: D("09:00"), checkOutAt: D("12:00") }),
      session({ sessionId: "2", checkInAt: D("14:00"), checkOutAt: D("19:00") }),
    ];
    const result = calculateDailyAttendance(sessions, workingDayContext);
    expect(result.scheduledMinutes).toBe(540);
    expect(result.workedMinutes).toBe(480);
    expect(result.overtimeMinutes).toBe(0);
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyDepartureMinutes).toBe(0);
    expect(result.status).toBe("PRESENT");
  });

  it("counts overtime correctly when the same-schedule sessions' total worked time exceeds scheduled", () => {
    const sessions = [
      session({ sessionId: "1", checkInAt: D("09:00"), checkOutAt: D("15:00") }),
      session({ sessionId: "2", checkInAt: D("15:30"), checkOutAt: D("19:00") }),
    ];
    const result = calculateDailyAttendance(sessions, workingDayContext);
    expect(result.scheduledMinutes).toBe(540);
    expect(result.workedMinutes).toBe(570);
    expect(result.overtimeMinutes).toBe(30);
  });

  it("Case 2: A(09-18) truncated by B(14-22) captured at a real second check-in — 780 scheduled, 0 overtime, early departure vs B's end", () => {
    const sessions = [
      session({ sessionId: "1", checkInAt: D("09:00"), checkOutAt: D("14:00"), expectedStartAt: D("09:00"), expectedEndAt: D("18:00") }),
      session({ sessionId: "2", checkInAt: D("14:00"), checkOutAt: D("18:00"), expectedStartAt: D("14:00"), expectedEndAt: D("22:00") }),
    ];
    const result = calculateDailyAttendance(sessions, workingDayContext);
    expect(result.scheduledMinutes).toBe(780);
    expect(result.workedMinutes).toBe(540);
    expect(result.overtimeMinutes).toBe(0);
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyDepartureMinutes).toBe(240);
  });

  it("Case 3 / Hardening Case C: one continuous session checking out well past A's own end — a later Workforce snapshot never captured by any event has zero effect, even though actual work extends into where B's window would have been", () => {
    // Only ONE session ever existed (09:00-22:00) — its snapshot is A (09-18), captured at 09:00.
    // Schedule B (16-22, or any later reassignment) is irrelevant: no check-in event ever observed
    // it, so the excess worked time (18:00-22:00) counts as overtime against A alone, not as a
    // truncation of A or an activation of B.
    const sessions = [session({ sessionId: "1", checkInAt: D("09:00"), checkOutAt: D("22:00") })];
    const result = calculateDailyAttendance(sessions, workingDayContext);
    expect(result.scheduledMinutes).toBe(540);
    expect(result.workedMinutes).toBe(780);
    expect(result.overtimeMinutes).toBe(240);
    expect(result.earlyDepartureMinutes).toBe(0);
  });

  it("Case 4: an explicit check-out/check-in split produces zero overtime (worked exactly matches the normalized schedule)", () => {
    const sessions = [
      session({ sessionId: "1", checkInAt: D("09:00"), checkOutAt: D("16:00"), expectedStartAt: D("09:00"), expectedEndAt: D("18:00") }),
      session({ sessionId: "2", checkInAt: D("16:00"), checkOutAt: D("22:00"), expectedStartAt: D("16:00"), expectedEndAt: D("22:00") }),
    ];
    const result = calculateDailyAttendance(sessions, workingDayContext);
    expect(result.scheduledMinutes).toBe(780);
    expect(result.workedMinutes).toBe(780);
    expect(result.overtimeMinutes).toBe(0);
  });

  it("applies grace period before counting late minutes", () => {
    const sessions = [session({ checkInAt: D("09:10"), gracePeriodMinutes: 15 })];
    const result = calculateDailyAttendance(sessions, workingDayContext);
    expect(result.lateMinutes).toBe(0);
  });

  it("counts late minutes beyond the grace period", () => {
    const sessions = [session({ checkInAt: D("09:20"), gracePeriodMinutes: 10 })];
    const result = calculateDailyAttendance(sessions, workingDayContext);
    expect(result.lateMinutes).toBe(10);
  });

  it("subtracts closed break minutes from worked time", () => {
    const sessions = [session({ breaks: [{ startAt: D("13:00"), endAt: D("13:30") }] })];
    const result = calculateDailyAttendance(sessions, workingDayContext);
    expect(result.breakMinutes).toBe(30);
    expect(result.workedMinutes).toBe(510);
  });

  it("marks the day INCOMPLETE with null worked/overtime when the last session has no checkout", () => {
    const sessions = [session({ checkOutAt: null, status: "OPEN" })];
    const result = calculateDailyAttendance(sessions, workingDayContext);
    expect(result.status).toBe("INCOMPLETE");
    expect(result.workedMinutes).toBeNull();
    expect(result.overtimeMinutes).toBeNull();
    expect(result.earlyDepartureMinutes).toBeNull();
  });

  it("marks a working day with zero sessions and a real expected window ABSENT", () => {
    const result = calculateDailyAttendance([], workingDayContext);
    expect(result.status).toBe("ABSENT");
    expect(result.scheduledMinutes).toBe(540);
    // Zero sessions is knowable, not ambiguous — workedMinutes is a real 0, not "unknown" (null is
    // reserved for a day containing an unclosed session, where the true worked time genuinely
    // cannot be computed).
    expect(result.workedMinutes).toBe(0);
    expect(result.overtimeMinutes).toBe(0);
  });

  it("marks a working day with zero sessions and no assignment NO_SCHEDULE, not ABSENT", () => {
    const context: DailyWorkforceContext = { isHoliday: false, isWeeklyOff: false, isWorkingDay: true, expectedStartAt: null, expectedEndAt: null, gracePeriodMinutes: 0 };
    const result = calculateDailyAttendance([], context);
    expect(result.status).toBe("NO_SCHEDULE");
    expect(result.scheduledMinutes).toBe(0);
  });

  it("CONFIRMED POLICY: an employee with no schedule assignment who actually checks in gets NO_SCHEDULE with scheduled=0, worked from real events, late/early=null, overtime=worked", () => {
    const noScheduleContext: DailyWorkforceContext = {
      isHoliday: false,
      isWeeklyOff: false,
      isWorkingDay: true,
      expectedStartAt: null,
      expectedEndAt: null,
      gracePeriodMinutes: 0,
    };
    const sessions = [session({ isWorkingDay: true, expectedStartAt: null, expectedEndAt: null, checkInAt: D("09:00"), checkOutAt: D("13:00") })];
    const result = calculateDailyAttendance(sessions, noScheduleContext);
    expect(result.status).toBe("NO_SCHEDULE");
    expect(result.scheduledMinutes).toBe(0);
    expect(result.workedMinutes).toBe(240); // computed from the real check-in/check-out, not forced to 0
    expect(result.lateMinutes).toBeNull();
    expect(result.earlyDepartureMinutes).toBeNull();
    expect(result.overtimeMinutes).toBe(result.workedMinutes); // scheduled=0 -> overtime collapses to worked
  });

  it("holiday with no check-in: HOLIDAY, holiday worked: HOLIDAY_WORKED with all worked minutes as overtime", () => {
    const holidayContext: DailyWorkforceContext = { isHoliday: true, isWeeklyOff: false, isWorkingDay: false, expectedStartAt: null, expectedEndAt: null, gracePeriodMinutes: 0 };
    expect(calculateDailyAttendance([], holidayContext).status).toBe("HOLIDAY");

    const worked = [session({ isHoliday: true, isWorkingDay: false, expectedStartAt: null, expectedEndAt: null })];
    const result = calculateDailyAttendance(worked, holidayContext);
    expect(result.status).toBe("HOLIDAY_WORKED");
    expect(result.scheduledMinutes).toBe(0);
    expect(result.overtimeMinutes).toBe(result.workedMinutes);
    expect(result.lateMinutes).toBeNull();
    expect(result.earlyDepartureMinutes).toBeNull();
  });

  it("weekly off with no check-in: WEEKLY_OFF, worked: WEEKLY_OFF_WORKED with all worked minutes as overtime", () => {
    const weeklyOffContext: DailyWorkforceContext = { isHoliday: false, isWeeklyOff: true, isWorkingDay: false, expectedStartAt: null, expectedEndAt: null, gracePeriodMinutes: 0 };
    expect(calculateDailyAttendance([], weeklyOffContext).status).toBe("WEEKLY_OFF");

    const worked = [session({ isWeeklyOff: true, isWorkingDay: false, expectedStartAt: null, expectedEndAt: null })];
    const result = calculateDailyAttendance(worked, weeklyOffContext);
    expect(result.status).toBe("WEEKLY_OFF_WORKED");
    expect(result.scheduledMinutes).toBe(0);
    expect(result.overtimeMinutes).toBe(result.workedMinutes);
  });

  it("Case 5 (allowOverlap-style anomaly): the same deterministic normalization applies regardless of why two snapshots overlap", () => {
    // Two snapshots whose wall-clock windows overlap due to an unusual allowOverlap assignment,
    // rather than an ordinary reassignment — the rule doesn't need to know why; it only needs the
    // chronological order of capturing sessions.
    const sessions = [
      session({ sessionId: "1", checkInAt: D("09:00"), checkOutAt: D("13:00"), expectedStartAt: D("09:00"), expectedEndAt: D("17:00") }),
      session({ sessionId: "2", checkInAt: D("13:00"), checkOutAt: D("20:00"), expectedStartAt: D("13:00"), expectedEndAt: D("21:00") }),
    ];
    const result = calculateDailyAttendance(sessions, workingDayContext);
    // period 1: 09-13 (truncated from 09-17), period 2: 13-21 -> 240 + 480 = 720
    expect(result.scheduledMinutes).toBe(720);
  });
});

describe("applyCorrectionsToSessions (Batch 4 correction adapter)", () => {
  it("Case 1: a paired missing check-in + missing check-out correction synthesizes one in-memory session — never a real attendance_events/attendance_open_sessions row", () => {
    // Our schema makes a literal "raw CHECK_OUT with no prior CHECK_IN" impossible (a session is
    // only ever created BY a check-in) — the real missing-check-in scenario is "the employee never
    // checked in at all", so both punches are missing and both must be corrected together.
    const overrides: AttendanceCorrectionOverride[] = [
      {
        correctionId: "c-checkin",
        fieldChanged: "CHECK_IN",
        eventId: null,
        correctedValue: D("09:00"),
        sessionId: null,
        syntheticSnapshot: {
          expectedStartAt: D("09:00"),
          expectedEndAt: D("18:00"),
          gracePeriodMinutes: 0,
          isHoliday: false,
          isWeeklyOff: false,
          isWorkingDay: true,
        },
      },
      { correctionId: "c-checkout", fieldChanged: "CHECK_OUT", eventId: null, correctedValue: D("18:00"), sessionId: null },
    ];

    const corrected = applyCorrectionsToSessions([], overrides);
    expect(corrected).toHaveLength(1);
    expect(corrected[0]!.checkInAt).toEqual(D("09:00"));
    expect(corrected[0]!.checkOutAt).toEqual(D("18:00"));
    expect(corrected[0]!.status).toBe("CLOSED");
    // Never a real session id — this row exists only for this one calculation.
    expect(corrected[0]!.sessionId.startsWith("correction-synthetic:")).toBe(true);

    const result = calculateDailyAttendance(corrected, workingDayContext);
    expect(result.status).toBe("PRESENT");
    expect(result.workedMinutes).toBe(540);
  });

  it("Case 2: missing checkout on a real open session — no longer INCOMPLETE once the override is applied", () => {
    const rawSessions = [session({ sessionId: "s1", checkInAt: D("09:00"), checkOutAt: null, status: "OPEN" })];
    expect(calculateDailyAttendance(rawSessions, workingDayContext).status).toBe("INCOMPLETE");

    const overrides: AttendanceCorrectionOverride[] = [
      { correctionId: "c1", fieldChanged: "CHECK_OUT", eventId: null, correctedValue: D("18:00"), sessionId: "s1" },
    ];
    const corrected = applyCorrectionsToSessions(rawSessions, overrides);
    expect(corrected[0]!.checkOutAt).toEqual(D("18:00"));
    expect(corrected[0]!.status).toBe("CLOSED");

    const result = calculateDailyAttendance(corrected, workingDayContext);
    expect(result.status).toBe("PRESENT");
    expect(result.workedMinutes).toBe(540);
  });

  it("Case 3: correcting an existing check-in changes the derived calculation while the input session object is left untouched (adapter never mutates its argument)", () => {
    const rawSessions = [session({ sessionId: "s1", checkInAt: D("09:25"), checkOutAt: D("18:00") })];
    const overrides: AttendanceCorrectionOverride[] = [
      { correctionId: "c1", fieldChanged: "CHECK_IN", eventId: "evt-checkin", correctedValue: D("09:00"), sessionId: "s1" },
    ];

    const corrected = applyCorrectionsToSessions(rawSessions, overrides);
    expect(corrected[0]!.checkInAt).toEqual(D("09:00"));
    // The array passed in is never mutated — `rawSessions[0]` still reflects the raw, uncorrected time.
    expect(rawSessions[0]!.checkInAt).toEqual(D("09:25"));

    const result = calculateDailyAttendance(corrected, workingDayContext);
    expect(result.lateMinutes).toBe(0);
    expect(result.workedMinutes).toBe(540);
  });

  it("with zero overrides, returns sessions equivalent to the raw input (pending/rejected corrections never reach this function at all)", () => {
    const rawSessions = [session({ sessionId: "s1" })];
    const corrected = applyCorrectionsToSessions(rawSessions, []);
    expect(corrected).toEqual(rawSessions);
  });

  it("overnight: a missing checkout on a night-shift session is corrected to next-day 06:10 without altering which session it belongs to", () => {
    const nightSession = session({
      sessionId: "night-1",
      checkInAt: new Date("2026-03-05T22:00:00Z"),
      checkOutAt: null,
      status: "OPEN",
      expectedStartAt: new Date("2026-03-05T22:00:00Z"),
      expectedEndAt: new Date("2026-03-06T06:00:00Z"),
    });
    const overrides: AttendanceCorrectionOverride[] = [
      {
        correctionId: "c1",
        fieldChanged: "CHECK_OUT",
        eventId: null,
        correctedValue: new Date("2026-03-06T06:10:00Z"),
        sessionId: "night-1",
      },
    ];
    const corrected = applyCorrectionsToSessions([nightSession], overrides);
    expect(corrected).toHaveLength(1);
    expect(corrected[0]!.sessionId).toBe("night-1");
    expect(corrected[0]!.checkOutAt).toEqual(new Date("2026-03-06T06:10:00Z"));
    expect(calculateDailyAttendance(corrected, workingDayContext).status).not.toBe("INCOMPLETE");
  });

  it("break correction: a missing break-end is resolved without an eventId, deriving corrected break minutes", () => {
    const withOpenBreak = session({ sessionId: "s1", breaks: [{ startAt: D("13:00"), endAt: null, startEventId: "e-start", endEventId: null }] });
    const overrides: AttendanceCorrectionOverride[] = [
      { correctionId: "c1", fieldChanged: "BREAK_END", eventId: null, correctedValue: D("13:30"), sessionId: "s1" },
    ];
    const corrected = applyCorrectionsToSessions([withOpenBreak], overrides);
    expect(corrected[0]!.breaks[0]!.endAt).toEqual(D("13:30"));
    const result = calculateDailyAttendance(corrected, workingDayContext);
    expect(result.breakMinutes).toBe(30);
    expect(result.workedMinutes).toBe(510);
  });

  it("break correction: a BREAK_START correction with an explicit eventId targets exactly that break, not any other", () => {
    const twoBreaks = session({
      sessionId: "s1",
      breaks: [
        { startAt: D("11:00"), endAt: D("11:15"), startEventId: "e1-start", endEventId: "e1-end" },
        { startAt: D("14:00"), endAt: D("14:15"), startEventId: "e2-start", endEventId: "e2-end" },
      ],
    });
    const overrides: AttendanceCorrectionOverride[] = [
      { correctionId: "c1", fieldChanged: "BREAK_START", eventId: "e2-start", correctedValue: D("13:50"), sessionId: "s1" },
    ];
    const corrected = applyCorrectionsToSessions([twoBreaks], overrides);
    expect(corrected[0]!.breaks[0]!.startAt).toEqual(D("11:00")); // untouched
    expect(corrected[0]!.breaks[1]!.startAt).toEqual(D("13:50")); // corrected
  });
});
