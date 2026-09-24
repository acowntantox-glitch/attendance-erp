/**
 * Pure, deterministic daily attendance calculation — no I/O, no Drizzle types, fully unit-testable
 * without a database or HTTP. Implements the approved "PHASE 4 ATTENDANCE — FINAL CALCULATION
 * AMENDMENT": expectation normalization over distinct per-session snapshots, then day-level
 * aggregation. See that document for the full derivation; this module implements its formulas
 * directly, section by section, with matching comments.
 */
import type {
  AttendanceCorrectionOverride,
  AttendanceSessionInput,
  DailyCalculationResult,
  DailyWorkforceContext,
  NormalizedExpectationPeriod,
} from "./model";

const MS_PER_MINUTE = 60_000;

/** Exported so the service layer can compute simple, non-authoritative display values (e.g. a
 *  single session's own duration for a UI table) from the same arithmetic the engine uses,
 *  instead of re-deriving it — this is plain subtraction, not business logic (normalization,
 *  precedence, and status classification stay in this module only). */
export function diffMinutes(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_MINUTE);
}

/** Sum of closed (start, end) break pairs, in minutes. Exported for the same reason as
 *  `diffMinutes` — reused by the service layer to report one session's own break time without
 *  duplicating the pairing logic that produces `breaks` in the first place. */
export function closedBreakMinutes(breaks: { startAt: Date; endAt: Date | null }[]): number {
  return breaks.filter((b) => b.endAt !== null).reduce((sum, b) => sum + diffMinutes(b.startAt, b.endAt!), 0);
}

/**
 * Groups a work date's chronologically-ordered sessions into distinct expectation *snapshots*
 * (identical expectedStartAt+expectedEndAt collapse into one, using the first session that
 * captured it as the ordering anchor — "Case 1" of the amendment: the same schedule captured by
 * multiple sessions must count its scheduled minutes exactly once), then normalizes them into
 * non-overlapping periods via:
 *
 *   operativeEnd[i] = max(expectedStart[i], min(expectedEnd[i], firstCapturedAt[i+1]))
 *
 * for every period except the last, which keeps its own expectedEnd untruncated. Because each
 * period's end is capped at the instant the next one was first observed, the resulting periods
 * cannot overlap — no expected minute is ever counted twice, by construction.
 *
 * Only sessions with a real expectedStartAt/expectedEndAt contribute a period; holiday/weekly-off/
 * no-schedule sessions (expectedStartAt === null) contribute nothing here — their scheduled
 * minutes are zero by definition (handled in `calculateDailyAttendance`).
 */
export function normalizeExpectationPeriods(sessions: AttendanceSessionInput[]): NormalizedExpectationPeriod[] {
  const scheduled = sessions
    .filter((s): s is AttendanceSessionInput & { expectedStartAt: Date; expectedEndAt: Date } => Boolean(s.expectedStartAt && s.expectedEndAt))
    .slice()
    .sort((a, b) => a.checkInAt.getTime() - b.checkInAt.getTime());

  const distinct: { expectedStart: Date; expectedEnd: Date; gracePeriodMinutes: number; firstCapturedAt: Date }[] = [];
  for (const session of scheduled) {
    const last = distinct[distinct.length - 1];
    const sameAsLast =
      last && last.expectedStart.getTime() === session.expectedStartAt.getTime() && last.expectedEnd.getTime() === session.expectedEndAt.getTime();
    if (!sameAsLast) {
      distinct.push({
        expectedStart: session.expectedStartAt,
        expectedEnd: session.expectedEndAt,
        gracePeriodMinutes: session.gracePeriodMinutes,
        firstCapturedAt: session.checkInAt,
      });
    }
  }

  return distinct.map((snapshot, index) => {
    const next = distinct[index + 1];
    const operativeEnd = next
      ? new Date(Math.max(snapshot.expectedStart.getTime(), Math.min(snapshot.expectedEnd.getTime(), next.firstCapturedAt.getTime())))
      : snapshot.expectedEnd;
    return {
      expectedStart: snapshot.expectedStart,
      expectedEnd: snapshot.expectedEnd,
      operativeEnd,
      gracePeriodMinutes: snapshot.gracePeriodMinutes,
      firstCapturedAt: snapshot.firstCapturedAt,
    };
  });
}

/**
 * Batch 4 correction adapter — the one place approved corrections meet the calculation engine.
 * Pure and DB-free: `overrides` must already be fully resolved by the service layer (which
 * session each targets, or that none exists yet and a synthetic one must be created — see
 * `AttendanceCorrectionOverride`). Returns a NEW array; `sessions` is never mutated, and nothing
 * here writes to (or even knows about) `attendance_events`/`attendance_open_sessions` — a
 * synthetic session created for a missing-check-in override exists only in this function's return
 * value, for this one calculation, never persisted as a real row.
 *
 * `calculateDailyAttendance` itself is untouched by Batch 4 — this function only prepares its
 * input, so there is exactly one implementation of normalization/precedence/status logic.
 */
export function applyCorrectionsToSessions(
  sessions: AttendanceSessionInput[],
  overrides: AttendanceCorrectionOverride[],
): AttendanceSessionInput[] {
  const bySessionId = new Map<string, AttendanceSessionInput>();
  for (const session of sessions) {
    bySessionId.set(session.sessionId, { ...session, breaks: session.breaks.map((b) => ({ ...b })) });
  }

  // A CHECK_IN override with no session (sessionId: null) creates a synthetic session — process
  // those first so a paired missing-CHECK_OUT override (also sessionId: null) has somewhere to attach.
  const ordered = [...overrides].sort((a, b) => {
    const aCreatesFirst = a.sessionId === null && a.fieldChanged === "CHECK_IN" ? 0 : 1;
    const bCreatesFirst = b.sessionId === null && b.fieldChanged === "CHECK_IN" ? 0 : 1;
    return aCreatesFirst - bCreatesFirst;
  });

  let syntheticSessionId: string | null = null;

  for (const override of ordered) {
    let target: AttendanceSessionInput | undefined;

    if (override.sessionId !== null) {
      target = bySessionId.get(override.sessionId);
    } else if (override.fieldChanged === "CHECK_IN") {
      const snapshot = override.syntheticSnapshot;
      const newSessionId = `correction-synthetic:${override.correctionId}`;
      const synthetic: AttendanceSessionInput = {
        sessionId: newSessionId,
        checkInAt: override.correctedValue,
        checkOutAt: null,
        status: "CLOSED",
        isHoliday: snapshot?.isHoliday ?? false,
        isWeeklyOff: snapshot?.isWeeklyOff ?? false,
        isWorkingDay: snapshot?.isWorkingDay ?? true,
        expectedStartAt: snapshot?.expectedStartAt ?? null,
        expectedEndAt: snapshot?.expectedEndAt ?? null,
        gracePeriodMinutes: snapshot?.gracePeriodMinutes ?? 0,
        breaks: [],
      };
      bySessionId.set(newSessionId, synthetic);
      syntheticSessionId = newSessionId;
      target = synthetic;
    } else {
      // Missing CHECK_OUT/BREAK_END with no explicit session: attaches to the one still-open
      // session for the day (the service validates this target is unique when the correction is
      // requested), falling back to a synthetic session just created by a paired override.
      target = [...bySessionId.values()].find((s) => s.checkOutAt === null) ?? (syntheticSessionId ? bySessionId.get(syntheticSessionId) : undefined);
    }

    if (!target) continue; // Nothing to apply to — the request-time validation should have caught this.

    switch (override.fieldChanged) {
      case "CHECK_IN":
        target.checkInAt = override.correctedValue;
        break;
      case "CHECK_OUT":
        target.checkOutAt = override.correctedValue;
        target.status = "CLOSED";
        break;
      case "BREAK_START": {
        const brk = target.breaks.find((b) => b.startEventId === override.eventId);
        if (brk) brk.startAt = override.correctedValue;
        break;
      }
      case "BREAK_END": {
        const brk = override.eventId
          ? target.breaks.find((b) => b.endEventId === override.eventId)
          : target.breaks.find((b) => b.endAt === null);
        if (brk) brk.endAt = override.correctedValue;
        break;
      }
    }
  }

  return [...bySessionId.values()];
}

/**
 * `sessions` must be every attendance session captured for one (employeeId, workDate) pair.
 * `dayContext` is a single fresh `getWorkforceDayInfo` result for that date — used only for
 * status classification and the zero-session ABSENT/NO_SCHEDULE case, never to override any
 * session's own frozen snapshot (see model.ts `DailyWorkforceContext`).
 */
export function calculateDailyAttendance(sessions: AttendanceSessionInput[], dayContext: DailyWorkforceContext): DailyCalculationResult {
  const ordered = sessions.slice().sort((a, b) => a.checkInAt.getTime() - b.checkInAt.getTime());
  const periods = normalizeExpectationPeriods(ordered);

  const hasUnclosedSession = ordered.some((s) => s.checkOutAt === null);

  const breakMinutes = ordered.reduce((sum, s) => sum + closedBreakMinutes(s.breaks), 0);

  let workedMinutes: number | null = null;
  if (!hasUnclosedSession) {
    workedMinutes = ordered.reduce((sum, s) => sum + diffMinutes(s.checkInAt, s.checkOutAt!) - closedBreakMinutes(s.breaks), 0);
  }

  // Scheduled minutes: sum of the normalized periods. If no session ever captured a real
  // expectation window but this IS a working day with an expected window and nobody checked in at
  // all, fall back to the fresh day-context window (the ABSENT case — there is no session snapshot
  // to normalize because there was no session).
  let scheduledMinutes = periods.reduce((sum, p) => sum + diffMinutes(p.expectedStart, p.operativeEnd), 0);
  if (periods.length === 0 && ordered.length === 0 && dayContext.isWorkingDay && dayContext.expectedStartAt && dayContext.expectedEndAt) {
    scheduledMinutes = diffMinutes(dayContext.expectedStartAt, dayContext.expectedEndAt);
  }

  const firstPeriod = periods[0];
  const lastPeriod = periods[periods.length - 1];
  const firstCheckInAt = ordered[0]?.checkInAt ?? null;
  const lastSession = ordered[ordered.length - 1];
  const lastCheckOutAt = lastSession?.checkOutAt ?? null;

  // null (not 0) when there is no period to measure against — holiday/weekly-off/no-schedule days
  // all fall here, by design: "not applicable" is a different fact from "on time" or "not early".
  const lateMinutes = firstPeriod
    ? Math.max(0, diffMinutes(firstPeriod.expectedStart, firstCheckInAt!) - firstPeriod.gracePeriodMinutes)
    : null;

  const earlyDepartureMinutes =
    lastPeriod && lastCheckOutAt !== null ? Math.max(0, diffMinutes(lastCheckOutAt, lastPeriod.operativeEnd)) : null;

  // With scheduledMinutes = 0 (holiday/weekly-off/no-schedule with no expectation period), this
  // collapses to exactly workedMinutes — confirmed intentional for NO_SCHEDULE (Batch 1 closure
  // decision) and matches the pre-existing HOLIDAY_WORKED/WEEKLY_OFF_WORKED precedent.
  const overtimeMinutes = workedMinutes === null ? null : Math.max(0, workedMinutes - scheduledMinutes);

  const status = determineStatus({
    dayContext,
    sessionCount: ordered.length,
    hasPeriods: periods.length > 0,
    hasUnclosedSession,
    lateMinutes,
  });

  return {
    status,
    scheduledMinutes,
    workedMinutes,
    breakMinutes,
    overtimeMinutes,
    lateMinutes,
    earlyDepartureMinutes,
    firstCheckInAt,
    lastCheckOutAt,
    sessionCount: ordered.length,
  };
}

function determineStatus(args: {
  dayContext: DailyWorkforceContext;
  sessionCount: number;
  hasPeriods: boolean;
  hasUnclosedSession: boolean;
  lateMinutes: number | null;
}): DailyCalculationResult["status"] {
  const { dayContext, sessionCount, hasPeriods, hasUnclosedSession, lateMinutes } = args;

  if (dayContext.isHoliday) return sessionCount > 0 ? "HOLIDAY_WORKED" : "HOLIDAY";
  if (dayContext.isWeeklyOff) return sessionCount > 0 ? "WEEKLY_OFF_WORKED" : "WEEKLY_OFF";

  if (sessionCount === 0) {
    // Working day, nobody checked in: ABSENT if there was something to be absent from, otherwise
    // there's no schedule to measure against at all — NO_SCHEDULE, not a punitive default (mirrors
    // the Workforce "fails open" precedent for missing configuration).
    return dayContext.isWorkingDay && dayContext.expectedStartAt ? "ABSENT" : "NO_SCHEDULE";
  }

  if (!hasPeriods) {
    // CONFIRMED PRODUCT DECISION (Batch 1 closure): check-in is always allowed even with no
    // Workforce schedule assignment — this branch is never a rejection, only a classification.
    // Sessions exist but none carried a real expectation window (no assignment covers this date),
    // so there is nothing to be "on time"/"early"/"late" against: scheduledMinutes stays 0 (the
    // no-periods branch above in calculateDailyAttendance), lateMinutes/earlyDepartureMinutes stay
    // null (no `firstPeriod`/`lastPeriod` to measure against — see below), and overtimeMinutes
    // collapses to exactly workedMinutes since max(0, workedMinutes - 0) = workedMinutes. No
    // Workforce mutation and no HR override occur anywhere in this path — see checkIn() in
    // service.ts, which never blocks or special-cases a missing assignment.
    return "NO_SCHEDULE";
  }

  if (hasUnclosedSession) return "INCOMPLETE";
  if (lateMinutes !== null && lateMinutes > 0) return "LATE";
  return "PRESENT";
}
