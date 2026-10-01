import { attendanceDailyStatusEnum } from "@/db/schema";
import { db } from "@/db/client";
import type { RequestContext } from "@/lib/auth/request-context";
import { assertCompanyAccess, requirePermission } from "@/lib/auth/request-context";
import { canReviewAttendanceCorrection } from "@/lib/auth/rbac";
import { AuthorizationError, isUniqueViolation } from "@/lib/errors";
import { recordAuditLog } from "@/domains/audit/service";
import { employeeRepository } from "@/domains/employee/repository";
import { EmployeeNotFoundError } from "@/domains/employee/errors";
import { getWorkforceDayInfo, resolveEmployeeTimezone, resolveWorkforceDayInfo } from "@/domains/workforce/service";
import type { WorkforceDayInfo } from "@/domains/workforce/model";
import { addDays, isValidIsoDate, utcToZonedWallTime, zonedWallTimeToUtc } from "@/lib/datetime";
import { applyCorrectionsToSessions, calculateDailyAttendance, closedBreakMinutes, diffMinutes } from "./calculation";
import { assertAttendancePeriodOpen, isAttendancePeriodClosed } from "./periods/attendance-period.service";
import { attendancePeriodRepository } from "./periods/attendance-period.repository";
import { resolveAttendancePolicy } from "./policy/attendance-policy.service";
import {
  attendanceCorrectionRepository,
  attendanceDailyRecordRepository,
  attendanceDashboardRepository,
  attendanceEventRepository,
  attendanceSessionRepository,
  lockAttendanceDay,
} from "./repository";
import {
  AlreadyCheckedInError,
  AttendanceChangedConcurrentlyError,
  IdempotencyKeyReuseError,
  InvalidAttendanceDateError,
  AttendanceCorrectionNotFoundError,
  AttendancePeriodLockedError,
  ConflictingCorrectionError,
  CorrectionAlreadyReviewedError,
  DuplicateAttendanceEventError,
  EmployeeNotEligibleForProcessingError,
  InsufficientCorrectionApprovalAuthorityError,
  InvalidCorrectionEventError,
  InvalidCorrectionTargetError,
  NoOpenBreakError,
  NoOpenSessionError,
  OpenBreakExistsError,
  RecalculationFailedError,
  SelfApprovalNotAllowedError,
} from "./errors";
import type {
  AttendanceCorrection,
  DailyCalculationResult,
  AttendancePolicy,
  AttendanceCorrectionField,
  AttendanceCorrectionOverride,
  AttendanceCorrectionQueueItem,
  AttendanceCorrectionWithDetails,
  AttendanceDailyRecord,
  AttendanceDailyStatus,
  AttendanceDayRecord,
  AttendanceDashboardFilters,
  AttendanceDashboardResult,
  AttendanceDashboardRow,
  AttendanceEvent,
  AttendanceSession,
  AttendanceSessionInput,
  AttendanceSessionView,
  AttendanceSessionWithSchedule,
  BreakInput,
  CheckInInput,
  CheckOutInput,
  CurrentlyWorkingRow,
  DailyWorkforceContext,
  IncompleteAttendanceRow,
  LateArrivalRow,
  ReviewCorrectionInput,
  RequestCorrectionInput,
} from "./model";
import type { DbExecutor, Transaction } from "@/db/client";

async function loadEmployeeInCompany(ctx: RequestContext, employeeId: string) {
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, employee.companyId);
  return employee;
}

/** EMPLOYEE is always pinned to their own record, ignoring any client-supplied employeeId — the
 *  same pattern `getWorkforceDayInfo` already uses. Every other role that holds the relevant
 *  permission may act on/view any employee within their own company (enforced by
 *  `loadEmployeeInCompany`'s `assertCompanyAccess`). */
function resolveTargetEmployeeId(ctx: RequestContext, requestedEmployeeId: string): string {
  if (ctx.role === "EMPLOYEE") {
    if (!ctx.employeeId) {
      throw new EmployeeNotFoundError();
    }
    return ctx.employeeId;
  }
  return requestedEmployeeId;
}

// ---------------------------------------------------------------------------
// F-07 - server-side date boundaries for every attendance write that names a date. The server's clock and
// the employee's own timezone decide what "today" is; nothing the client sends is trusted for it.
// ---------------------------------------------------------------------------

/** Clock-skew allowance for a corrected TIME the user typed in (never for a work date). */
const CORRECTION_TIME_TOLERANCE_MS = 5 * 60_000;

export function assertValidWorkDate(workDate: string): void {
  if (!isValidIsoDate(workDate)) throw new InvalidAttendanceDateError("The work date must be a real calendar date (YYYY-MM-DD).");
}

/** A work date later than the current date in `timezone` has not happened: it may be read (a provisional
 *  view) but never written, recalculated, processed or corrected. Past dates are always allowed. */
export function assertWorkDateNotInFuture(workDate: string, timezone: string, now: Date = new Date()): void {
  assertValidWorkDate(workDate);
  if (workDate > utcToZonedWallTime(now, timezone).date) {
    throw new InvalidAttendanceDateError("Attendance cannot be recorded, recalculated or corrected for a date that has not happened yet.");
  }
}

// ---------------------------------------------------------------------------
// Work date resolution + Workforce snapshot capture (approved Phase 4 design)
// ---------------------------------------------------------------------------

/**
 * Resolves the work date a new CHECK_IN belongs to, then captures the Workforce expectation for
 * that date. Rule (no arbitrary time buffer):
 *   1. Find the employee's most recent attendance session, open or closed or abandoned.
 *   2. If it has a real expectedEndAt and this check-in instant is strictly before it, inherit
 *      that session's work date (this check-in is still within that session's expected window).
 *   3. Otherwise resolve fresh from the employee's local calendar date.
 * The snapshot itself is always resolved fresh via `getWorkforceDayInfo` for whichever work date
 * was determined above — never re-used from the prior session's own snapshot.
 */
async function resolveCheckInContext(ctx: RequestContext, employeeId: string, checkInInstant: Date) {
  const priorSession = await attendanceSessionRepository.findMostRecentForEmployee(employeeId);

  let workDate: string;
  if (priorSession?.expectedEndAt && checkInInstant.getTime() < priorSession.expectedEndAt.getTime()) {
    workDate = priorSession.workDate;
  } else {
    const timezone = await resolveEmployeeTimezone(ctx, employeeId);
    workDate = utcToZonedWallTime(checkInInstant, timezone).date;
  }

  const [dayInfo, policy] = await Promise.all([getWorkforceDayInfo(ctx, employeeId, workDate), resolveAttendancePolicy(ctx.companyId, workDate)]);
  const window = dayInfo.expectedWindow;
  return {
    workDate,
    dayInfo,
    expectedStartAt: window ? zonedWallTimeToUtc(window.start.date, window.start.time, dayInfo.timezone) : null,
    expectedEndAt: window ? zonedWallTimeToUtc(window.end.date, window.end.time, dayInfo.timezone) : null,
    // Shift grace is authoritative; the company policy is only a fallback for a schedule with no
    // shift. The value is frozen on the session, so a later policy change never rewrites history.
    gracePeriodMinutes: dayInfo.scheduleAssignment?.shift?.gracePeriodMinutes ?? policy.defaultGracePeriodMinutes,
  };
}

// ---------------------------------------------------------------------------
// Check-in / check-out / breaks
// ---------------------------------------------------------------------------

// F-01 — keeping stored daily records consistent with attendance state changes.
//
// Invariant: an EXISTING daily record is recalculated, in the same transaction and under the same
// per-(employee, work date) lock, by every state change (check-in, break start/end, check-out,
// abandon). A record is only CREATED by check-out, an explicit HR recalculation/Process Day, a
// correction approval or the scheduled job - never by check-in/breaks (that would put every live
// employee into the persisted INCOMPLETE population) and never by a read.
//
// `resolveWorkforceDayInfo` reads through the global pool, so it is resolved BEFORE the transaction
// opens and passed in: a transaction that waited on a second pooled connection while holding its own
// could starve the pool under concurrent punches.

/** Resolves the day's Workforce info up front, but only when a stored record exists (the only case
 *  in which the transaction will recalculate it). */
async function preloadDayInfoIfRecordExists(companyId: string, employeeId: string, workDate: string): Promise<WorkforceDayInfo | undefined> {
  if (!(await attendanceDailyRecordRepository.findOne(employeeId, workDate))) return undefined;
  return resolveWorkforceDayInfo(companyId, employeeId, workDate);
}

async function refreshDailyRecordIfExists(
  companyId: string,
  employeeId: string,
  workDate: string,
  tx: Transaction,
  dayInfo?: WorkforceDayInfo,
): Promise<void> {
  if (!(await attendanceDailyRecordRepository.findOne(employeeId, workDate, tx))) return;
  await recalculateDailyRecordInternal(companyId, employeeId, workDate, tx, dayInfo);
}

/**
 * F-20 - the event a retry's idempotency key already produced, or null. A key that belongs to a
 * DIFFERENT kind of action (check-in vs check-out vs break) is refused: it is a retry token for one
 * action, never a lookup into another one's result. Pass `tx` to look inside a transaction (after the
 * day lock, so a concurrent first request that has just committed is seen).
 */
async function findIdempotentReplay(
  employeeId: string,
  idempotencyKey: string,
  expected: AttendanceEvent["eventType"],
  executor: DbExecutor = db,
): Promise<AttendanceEvent | null> {
  const event = await attendanceEventRepository.findByIdempotencyKey(employeeId, idempotencyKey, executor);
  if (!event) return null;
  if (event.eventType !== expected) throw new IdempotencyKeyReuseError();
  return event;
}

/**
 * The lock-order prologue shared by check-out and the break operations: period lock -> day lock ->
 * open-session row lock. The session's work date is only known from an unlocked peek, so after
 * locking the real row is re-read and must be the same session; if it changed in between (a
 * concurrent punch on another work date) nothing is written and the caller retries.
 */
async function lockOpenSessionForPunch(
  companyId: string,
  employeeId: string,
  peek: { id: string; workDate: string },
  tx: Transaction,
  idempotency?: { key: string | undefined; expected: AttendanceEvent["eventType"] },
) {
  await assertAttendancePeriodOpen(companyId, peek.workDate, tx);
  await lockAttendanceDay(tx, employeeId, peek.workDate);
  // F-20 - under the day lock: a concurrent request with the same key that has just committed is a replay
  // (return its result), not "no open session".
  if (idempotency?.key) {
    const replay = await findIdempotentReplay(employeeId, idempotency.key, idempotency.expected, tx);
    if (replay) return { kind: "replay" as const, replay };
  }
  const open = await attendanceSessionRepository.findOpenForEmployeeLocked(employeeId, tx);
  if (!open) throw new NoOpenSessionError();
  if (open.id !== peek.id) throw new AttendanceChangedConcurrentlyError();
  return { kind: "open" as const, open };
}

export async function checkIn(ctx: RequestContext, requestedEmployeeId: string, input: CheckInInput = {}): Promise<AttendanceSession> {
  requirePermission(ctx, "attendance.check_in");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  const employee = await loadEmployeeInCompany(ctx, targetEmployeeId);

  // Batch 11 hardening — mirrors attendance-processing.service.ts's `assertEligible`: an
  // archived or non-ACTIVE employee (resigned, terminated, suspended, etc.) must not be able to
  // open a brand-new attendance session. Deliberately checked only here, not in
  // `loadEmployeeInCompany` (shared by every attendance function, including read paths like
  // `getAttendanceDay`/`listAttendanceForEmployee`) — HR must still be able to view an archived
  // employee's historical attendance, and check-out/break-end must still be able to close out a
  // session that was legitimately opened before the employee's status changed.
  if (employee.isArchived || employee.employmentStatus !== "ACTIVE") {
    throw new EmployeeNotEligibleForProcessingError();
  }

  if (input.idempotencyKey) {
    const replay = await findIdempotentReplay(targetEmployeeId, input.idempotencyKey, "CHECK_IN");
    const existingSession = replay ? await attendanceSessionRepository.findById(replay.sessionId) : null;
    if (existingSession) return existingSession;
  }

  const occurredAt = new Date();
  const { workDate, dayInfo, expectedStartAt, expectedEndAt, gracePeriodMinutes } = await resolveCheckInContext(ctx, targetEmployeeId, occurredAt);

  // F-01 - an unlocked peek tells us whether an older session may be abandoned by this check-in, so
  // its work date's day lock can be taken (in a fixed order) BEFORE the session row lock. Day infos
  // for the records that may need refreshing are resolved before the transaction opens.
  const peekOpen = await attendanceSessionRepository.findOpenForEmployee(targetEmployeeId);
  const previousWorkDate = peekOpen && peekOpen.workDate !== workDate ? peekOpen.workDate : null;
  const previousDayInfo = previousWorkDate ? await preloadDayInfoIfRecordExists(ctx.companyId, targetEmployeeId, previousWorkDate) : undefined;

  // F-05 - set only when this check-in actually abandons an older session; audited AFTER the commit so a
  // rolled-back check-in never leaves an "abandoned" audit entry behind.
  let abandoned: { id: string; status: string; workDate: string } | null = null;
  let replayed = false;

  const session = await db.transaction(async (tx) => {
    abandoned = null; // (a retried/aborted attempt must not leak a previous attempt's value)
    replayed = false;
    // Batch 8 — must be the first thing this transaction does: the SHARE lock it takes on the
    // period row is what makes this check race-safe against a concurrent close (see
    // attendance-period.repository.ts's module doc).
    await assertAttendancePeriodOpen(ctx.companyId, workDate, tx);

    // F-01 - day lock(s) next, sorted so two requests can never take them in opposite orders.
    for (const lockDate of [...new Set([workDate, previousWorkDate].filter((d): d is string => d !== null))].sort()) {
      await lockAttendanceDay(tx, targetEmployeeId, lockDate);
    }

    // Row-locked implicitly by the partial unique index on (employeeId) WHERE status='OPEN' — a
    // concurrent duplicate check-in racing this same check fails on that constraint below, not on
    // an explicit SELECT ... FOR UPDATE (there is no existing row to lock for a brand-new session).
    // F-20 - a concurrent request with the SAME key that has just committed: this is its retry, so return
    // that session instead of failing with "already checked in" (or double-writing).
    if (input.idempotencyKey) {
      const replay = await findIdempotentReplay(targetEmployeeId, input.idempotencyKey, "CHECK_IN", tx);
      const replaySession = replay ? await attendanceSessionRepository.findById(replay.sessionId, tx) : null;
      if (replaySession) {
        replayed = true;
        return replaySession;
      }
    }

    const openExisting = await attendanceSessionRepository.findOpenForEmployeeLocked(targetEmployeeId, tx);
    if (openExisting && openExisting.workDate !== workDate && openExisting.workDate !== previousWorkDate) {
      // An open session on a work date we did not lock appeared after the peek.
      throw new AttendanceChangedConcurrentlyError();
    }
    if (openExisting) {
      if (openExisting.workDate === workDate) {
        // Still within the same work date as the open session — this is a genuine "already
        // checked in" conflict, not a stale/forgotten session.
        throw new AlreadyCheckedInError();
      }
      // The open session belongs to an earlier work date than this check-in resolved to (the same
      // no-buffer rule above already determined this check-in does NOT belong to it) — it was
      // never closed and is now superseded. Transition it out rather than blocking this check-in
      // forever (§11: "the employee must still be able to CHECK_IN on a later day").
      await attendanceSessionRepository.markAbandoned(tx, openExisting.id);
      abandoned = { id: openExisting.id, status: openExisting.status, workDate: openExisting.workDate };
      // F-01 - the abandoned session's work date: refresh its record if one exists (never create
      // one). A closed period keeps its existing frozen behaviour: it is left untouched.
      const previousPeriod = await attendancePeriodRepository.findByCompanyAndMonth(ctx.companyId, openExisting.workDate.slice(0, 7), tx);
      if (previousPeriod?.status !== "CLOSED") {
        await refreshDailyRecordIfExists(ctx.companyId, targetEmployeeId, openExisting.workDate, tx, previousDayInfo);
      }
    }

    try {
      const newSession = await attendanceSessionRepository.create(tx, {
        companyId: ctx.companyId,
        employeeId: targetEmployeeId,
        workDate,
        checkInAt: occurredAt,
        expectedWorkScheduleId: dayInfo.scheduleAssignment?.workScheduleId ?? null,
        expectedShiftId: dayInfo.scheduleAssignment?.shiftId ?? null,
        expectedStartAt,
        expectedEndAt,
        resolvedTimezone: dayInfo.timezone,
        gracePeriodMinutes,
        isHoliday: dayInfo.isHoliday,
        isWeeklyOff: dayInfo.isWeeklyOff,
        isWorkingDay: dayInfo.isWorkingDay,
        source: input.source ?? "MANUAL",
      });

      await attendanceEventRepository.create(tx, {
        companyId: ctx.companyId,
        employeeId: targetEmployeeId,
        sessionId: newSession.id,
        workDate,
        eventType: "CHECK_IN",
        occurredAt,
        source: input.source ?? "MANUAL",
        sourceMetadata: input.sourceMetadata ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      });

      // F-01 - an existing record for this work date must reflect the new session; none is created. The
      // existence check happens HERE, under the day lock, never from a pre-transaction peek: a record the
      // scheduled job inserted a moment ago must be seen.
      await refreshDailyRecordIfExists(ctx.companyId, targetEmployeeId, workDate, tx, dayInfo);

      return newSession;
    } catch (error) {
      if (isUniqueViolation(error)) throw new AlreadyCheckedInError();
      throw error;
    }
  });

  if (replayed) return session; // the original request already wrote (and audited) everything

  const abandonedSession = abandoned as { id: string; status: string; workDate: string } | null;
  if (abandonedSession) {
    await recordAuditLog(ctx, {
      action: "attendance.session.abandon",
      entityType: "attendance_session",
      entityId: abandonedSession.id,
      oldData: { status: abandonedSession.status, workDate: abandonedSession.workDate },
      newData: { status: "ABANDONED" },
      metadata: { employeeId: targetEmployeeId, supersededByWorkDate: workDate },
    });
  }

  await recordAuditLog(ctx, {
    action: "attendance.check_in",
    entityType: "attendance_session",
    entityId: session.id,
    newData: session,
    metadata: { employeeId: targetEmployeeId },
  });

  return session;
}

export async function checkOut(ctx: RequestContext, requestedEmployeeId: string, input: CheckOutInput = {}): Promise<AttendanceSession> {
  requirePermission(ctx, "attendance.check_out");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  await loadEmployeeInCompany(ctx, targetEmployeeId);

  if (input.idempotencyKey) {
    const replay = await findIdempotentReplay(targetEmployeeId, input.idempotencyKey, "CHECK_OUT");
    const existingSession = replay ? await attendanceSessionRepository.findById(replay.sessionId) : null;
    if (existingSession) return existingSession;
  }

  const occurredAt = new Date();

  const peek = await attendanceSessionRepository.findOpenForEmployee(targetEmployeeId);
  if (!peek) {
    // F-20 - nothing open because a first request with this key already closed it: that is a retry.
    if (input.idempotencyKey) {
      const replay = await findIdempotentReplay(targetEmployeeId, input.idempotencyKey, "CHECK_OUT");
      const replaySession = replay ? await attendanceSessionRepository.findById(replay.sessionId) : null;
      if (replaySession) return replaySession;
    }
    throw new NoOpenSessionError();
  }
  // Check-out ALWAYS calculates (and creates, if absent) the day's record - inside this transaction.
  const dayInfo = await resolveWorkforceDayInfo(ctx.companyId, targetEmployeeId, peek.workDate);

  let replayedCheckOut = false;
  const session = await db.transaction(async (tx) => {
    replayedCheckOut = false;
    const locked = await lockOpenSessionForPunch(ctx.companyId, targetEmployeeId, peek, tx, { key: input.idempotencyKey, expected: "CHECK_OUT" });
    if (locked.kind === "replay") {
      const original = await attendanceSessionRepository.findById(locked.replay.sessionId, tx);
      if (!original) throw new NoOpenSessionError();
      replayedCheckOut = true;
      return original;
    }
    const open = locked.open;

    const openBreak = await attendanceEventRepository.findOpenBreak(open.id, tx);
    if (openBreak) throw new OpenBreakExistsError();

    try {
      await attendanceEventRepository.create(tx, {
        companyId: ctx.companyId,
        employeeId: targetEmployeeId,
        sessionId: open.id,
        workDate: open.workDate,
        eventType: "CHECK_OUT",
        occurredAt,
        source: input.source ?? "MANUAL",
        sourceMetadata: input.sourceMetadata ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateAttendanceEventError();
      throw error;
    }

    const closed = await attendanceSessionRepository.markClosed(tx, open.id, occurredAt);

    // F-01 - atomic with the punch: a committed check-out always has a consistent daily record. If
    // the calculation or write fails, the whole check-out rolls back and the retry starts clean.
    await recalculateDailyRecordInternal(ctx.companyId, targetEmployeeId, closed.workDate, tx, dayInfo);
    return closed;
  });

  if (replayedCheckOut) return session; // already written and audited by the original request

  await recordAuditLog(ctx, {
    action: "attendance.check_out",
    entityType: "attendance_session",
    entityId: session.id,
    newData: session,
    metadata: { employeeId: targetEmployeeId },
  });

  return session;
}

export async function startBreak(ctx: RequestContext, requestedEmployeeId: string, input: BreakInput = {}): Promise<AttendanceEvent> {
  // Breaks are sub-states of an open session — gated by the same two capabilities that open/close
  // a session (there is no separate attendance.break_* permission in the approved Batch 1 RBAC set).
  requirePermission(ctx, "attendance.check_in");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  await loadEmployeeInCompany(ctx, targetEmployeeId);

  if (input.idempotencyKey) {
    const existing = await findIdempotentReplay(targetEmployeeId, input.idempotencyKey, "BREAK_START");
    if (existing) return existing;
  }

  const occurredAt = new Date();

  const peek = await attendanceSessionRepository.findOpenForEmployee(targetEmployeeId);
  if (!peek) throw new NoOpenSessionError();
  const dayInfo = await preloadDayInfoIfRecordExists(ctx.companyId, targetEmployeeId, peek.workDate);

  let replayedBreak: AttendanceEvent | null = null;
  const event = await db.transaction(async (tx) => {
    replayedBreak = null;
    const locked = await lockOpenSessionForPunch(ctx.companyId, targetEmployeeId, peek, tx, { key: input.idempotencyKey, expected: "BREAK_START" });
    if (locked.kind === "replay") {
      replayedBreak = locked.replay;
      return locked.replay;
    }
    const open = locked.open;
    const openBreak = await attendanceEventRepository.findOpenBreak(open.id, tx);
    if (openBreak) throw new OpenBreakExistsError();

    try {
      const created = await attendanceEventRepository.create(tx, {
        companyId: ctx.companyId,
        employeeId: targetEmployeeId,
        sessionId: open.id,
        workDate: open.workDate,
        eventType: "BREAK_START",
        occurredAt,
        source: input.source ?? "MANUAL",
        sourceMetadata: input.sourceMetadata ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      });
      await refreshDailyRecordIfExists(ctx.companyId, targetEmployeeId, open.workDate, tx, dayInfo);
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateAttendanceEventError();
      throw error;
    }
  });

  if (replayedBreak) return event; // already written and audited by the original request

  await recordAuditLog(ctx, {
    action: "attendance.break_start",
    entityType: "attendance_event",
    entityId: event.id,
    newData: event,
    metadata: { employeeId: targetEmployeeId },
  });

  return event;
}

export async function endBreak(ctx: RequestContext, requestedEmployeeId: string, input: BreakInput = {}): Promise<AttendanceEvent> {
  requirePermission(ctx, "attendance.check_out");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  await loadEmployeeInCompany(ctx, targetEmployeeId);

  if (input.idempotencyKey) {
    const existing = await findIdempotentReplay(targetEmployeeId, input.idempotencyKey, "BREAK_END");
    if (existing) return existing;
  }

  const occurredAt = new Date();

  const peek = await attendanceSessionRepository.findOpenForEmployee(targetEmployeeId);
  if (!peek) throw new NoOpenSessionError();
  const dayInfo = await preloadDayInfoIfRecordExists(ctx.companyId, targetEmployeeId, peek.workDate);

  let replayedBreak: AttendanceEvent | null = null;
  const event = await db.transaction(async (tx) => {
    replayedBreak = null;
    const locked = await lockOpenSessionForPunch(ctx.companyId, targetEmployeeId, peek, tx, { key: input.idempotencyKey, expected: "BREAK_END" });
    if (locked.kind === "replay") {
      replayedBreak = locked.replay;
      return locked.replay;
    }
    const open = locked.open;
    const openBreak = await attendanceEventRepository.findOpenBreak(open.id, tx);
    if (!openBreak) throw new NoOpenBreakError();

    try {
      const created = await attendanceEventRepository.create(tx, {
        companyId: ctx.companyId,
        employeeId: targetEmployeeId,
        sessionId: open.id,
        workDate: open.workDate,
        eventType: "BREAK_END",
        occurredAt,
        source: input.source ?? "MANUAL",
        sourceMetadata: input.sourceMetadata ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      });
      await refreshDailyRecordIfExists(ctx.companyId, targetEmployeeId, open.workDate, tx, dayInfo);
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateAttendanceEventError();
      throw error;
    }
  });

  if (replayedBreak) return event; // already written and audited by the original request

  await recordAuditLog(ctx, {
    action: "attendance.break_end",
    entityType: "attendance_event",
    entityId: event.id,
    newData: event,
    metadata: { employeeId: targetEmployeeId },
  });

  return event;
}

/** Enriches a raw session with display-only duration/break totals (see `AttendanceSessionView`)
 *  and reports whether it currently has an open break — both derived server-side from the same
 *  event-stream reading `calculation.ts` already uses, never re-implemented in the UI. */
async function toSessionView(session: AttendanceSessionWithSchedule): Promise<AttendanceSessionView> {
  const breaks = await attendanceEventRepository.listBreaksForSession(session.id);
  const sessionBreakMinutes = closedBreakMinutes(breaks);
  const sessionWorkedMinutes = session.checkOutAt ? diffMinutes(session.checkInAt, session.checkOutAt) - sessionBreakMinutes : null;
  return { ...session, sessionBreakMinutes, sessionWorkedMinutes, breaks };
}

export async function getCurrentSession(
  ctx: RequestContext,
  requestedEmployeeId: string,
): Promise<{ session: AttendanceSessionView | null; hasOpenBreak: boolean }> {
  requirePermission(ctx, "attendance.view");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  await loadEmployeeInCompany(ctx, targetEmployeeId);

  const open = await attendanceSessionRepository.findOpenForEmployee(targetEmployeeId);
  if (!open) return { session: null, hasOpenBreak: false };

  const [view, openBreak] = await Promise.all([toSessionView(open), attendanceEventRepository.findOpenBreak(open.id)]);
  return { session: view, hasOpenBreak: Boolean(openBreak) };
}

// ---------------------------------------------------------------------------
// Daily calculation
// ---------------------------------------------------------------------------

async function buildSessionInputs(employeeId: string, workDate: string, executor: DbExecutor = db): Promise<AttendanceSessionInput[]> {
  const sessions = await attendanceSessionRepository.listForEmployeeWorkDate(employeeId, workDate, executor);
  return Promise.all(
    sessions.map(async (s) => ({
      sessionId: s.id,
      checkInAt: s.checkInAt,
      checkOutAt: s.checkOutAt,
      status: s.status,
      isHoliday: s.isHoliday,
      isWeeklyOff: s.isWeeklyOff,
      isWorkingDay: s.isWorkingDay,
      expectedStartAt: s.expectedStartAt,
      expectedEndAt: s.expectedEndAt,
      gracePeriodMinutes: s.gracePeriodMinutes,
      breaks: await attendanceEventRepository.listBreaksForSession(s.id, executor),
    })),
  );
}

/**
 * Resolves which session a *missing-punch* correction (no `eventId`) attaches to — the same rule
 * used both to validate a correction request (there must be exactly one legitimate target right
 * now) and, later, to build the calculation override for an approved correction. `null` for
 * CHECK_IN means "no session exists yet — the calculation adapter synthesizes one in memory only"
 * (see `applyCorrectionsToSessions`); throws `InvalidCorrectionTargetError` whenever the target is
 * not uniquely determined. BREAK_START has no missing-punch case: a break can never end before it
 * starts, so a real "missing start" cannot occur — such a correction must reference the event.
 */
async function resolveMissingPunchSessionId(
  employeeId: string,
  workDate: string,
  fieldChanged: AttendanceCorrectionField,
  executor: DbExecutor,
): Promise<string | null> {
  if (fieldChanged === "CHECK_IN") {
    const sessions = await attendanceSessionRepository.listForEmployeeWorkDate(employeeId, workDate, executor);
    if (sessions.length > 0) {
      throw new InvalidCorrectionTargetError(
        "A check-in correction with no referenced event is only valid when no session exists yet for this work date.",
      );
    }
    return null;
  }

  if (fieldChanged === "CHECK_OUT") {
    const sessions = await attendanceSessionRepository.listForEmployeeWorkDate(employeeId, workDate, executor);
    const openSessions = sessions.filter((s) => s.checkOutAt === null);
    if (openSessions.length !== 1) {
      throw new InvalidCorrectionTargetError(
        "A check-out correction with no referenced event requires exactly one open session for this work date.",
      );
    }
    return openSessions[0]!.id;
  }

  if (fieldChanged === "BREAK_END") {
    const sessions = await attendanceSessionRepository.listForEmployeeWorkDate(employeeId, workDate, executor);
    const withOpenBreak: string[] = [];
    for (const session of sessions) {
      const openBreak = await attendanceEventRepository.findOpenBreak(session.id, executor);
      if (openBreak) withOpenBreak.push(session.id);
    }
    if (withOpenBreak.length !== 1) {
      throw new InvalidCorrectionTargetError(
        "A break-end correction with no referenced event requires exactly one open break for this work date.",
      );
    }
    return withOpenBreak[0]!;
  }

  throw new InvalidCorrectionTargetError("A break-start correction must reference the event being corrected (eventId is required).");
}

/** Validates a correction's `eventId` (§13): must exist, and belong to this employee, this
 *  company, this work date, and this exact field. */
async function resolveCorrectionEventTarget(
  ctx: RequestContext,
  employeeId: string,
  workDate: string,
  fieldChanged: AttendanceCorrectionField,
  eventId: string,
  executor: DbExecutor,
): Promise<AttendanceEvent> {
  const event = await attendanceEventRepository.findById(eventId, executor);
  if (
    !event ||
    event.employeeId !== employeeId ||
    event.companyId !== ctx.companyId ||
    event.workDate !== workDate ||
    event.eventType !== fieldChanged
  ) {
    throw new InvalidCorrectionEventError();
  }
  return event;
}

/**
 * Resolves one stored, APPROVED correction into the calculation adapter's override input (see
 * `AttendanceCorrectionOverride`) — the only DB-aware step between the correction table and the
 * pure `applyCorrectionsToSessions`. Re-resolves a missing-punch target the same way the request
 * was originally validated, rather than trusting anything cached on the correction row, so a
 * session created for another correction is caught rather than being applied to the wrong target.
 */
async function buildCorrectionOverride(
  companyId: string,
  correction: AttendanceCorrection,
  executor: DbExecutor,
  policy: AttendancePolicy,
): Promise<AttendanceCorrectionOverride> {
  if (correction.eventId) {
    const event = await attendanceEventRepository.findById(correction.eventId, executor);
    return {
      correctionId: correction.id,
      fieldChanged: correction.fieldChanged,
      eventId: correction.eventId,
      correctedValue: correction.correctedValue,
      sessionId: event?.sessionId ?? null,
    };
  }

  if (correction.fieldChanged === "CHECK_IN") {
    // No real check-in ever existed for this correction, so there is no frozen session snapshot
    // to reuse — resolve a fresh Workforce expectation for the synthetic session, same as a real
    // check-in would capture at the moment it occurred.
    const dayInfo = await resolveWorkforceDayInfo(companyId, correction.employeeId, correction.workDate);
    const window = dayInfo.expectedWindow;
    return {
      correctionId: correction.id,
      fieldChanged: correction.fieldChanged,
      eventId: null,
      correctedValue: correction.correctedValue,
      sessionId: null,
      syntheticSnapshot: {
        expectedStartAt: window ? zonedWallTimeToUtc(window.start.date, window.start.time, dayInfo.timezone) : null,
        expectedEndAt: window ? zonedWallTimeToUtc(window.end.date, window.end.time, dayInfo.timezone) : null,
        gracePeriodMinutes: dayInfo.scheduleAssignment?.shift?.gracePeriodMinutes ?? policy.defaultGracePeriodMinutes,
        isHoliday: dayInfo.isHoliday,
        isWeeklyOff: dayInfo.isWeeklyOff,
        isWorkingDay: dayInfo.isWorkingDay,
      },
    };
  }

  // F-05 - approving a missing-CHECK_OUT correction closes the stranded OPEN session itself (see
  // `closeSessionResolvedByCorrection`), so on every later recalculation the target is that already-
  // closed session, not "the one open session".
  const sessionId =
    (correction.fieldChanged === "CHECK_OUT" ? await findSessionClosedByCorrection(correction, executor) : null) ??
    (await resolveMissingPunchSessionId(correction.employeeId, correction.workDate, correction.fieldChanged, executor));
  return {
    correctionId: correction.id,
    fieldChanged: correction.fieldChanged,
    eventId: null,
    correctedValue: correction.correctedValue,
    sessionId,
  };
}

/**
 * F-05 - the session a missing-CHECK_OUT correction already closed: CLOSED, `checkOutAt` exactly the
 * correction's value, and no real CHECK_OUT event (a genuine check-out always has one). Deterministic
 * because `closeSessionResolvedByCorrection` is the only writer of that combination.
 */
async function findSessionClosedByCorrection(correction: AttendanceCorrection, executor: DbExecutor): Promise<string | null> {
  const sessions = await attendanceSessionRepository.listForEmployeeWorkDate(correction.employeeId, correction.workDate, executor);
  const candidates = sessions.filter((s) => s.status === "CLOSED" && s.checkOutAt?.getTime() === correction.correctedValue.getTime());
  if (candidates.length === 0) return null;
  const events = await attendanceEventRepository.listForEmployeeWorkDate(correction.employeeId, correction.workDate, executor);
  const withRealCheckOut = new Set(events.filter((e) => e.eventType === "CHECK_OUT").map((e) => e.sessionId));
  return candidates.find((s) => !withRealCheckOut.has(s.id))?.id ?? null;
}

/**
 * F-05 - an approved "I forgot to check out" correction supplies the missing check-out, so the
 * session it resolves must leave OPEN. Left OPEN it would (a) block closing the attendance period
 * (`countOpenInRange`), (b) keep the employee's same-work-date check-in refused (`AlreadyCheckedIn`)
 * and (c) never resolve at all for an employee who has left (check-in is refused for them). Only a
 * session still OPEN is closed - an ABANDONED one is already out of the way. The events stay
 * untouched (no synthetic CHECK_OUT event): the correction row is the record of why. Runs inside the
 * approval transaction, under the day lock, before any session row lock (period -> day -> session).
 */
async function closeSessionResolvedByCorrection(correction: AttendanceCorrection, tx: Transaction): Promise<void> {
  await lockAttendanceDay(tx, correction.employeeId, correction.workDate);
  const open = await attendanceSessionRepository.findOpenForEmployeeLocked(correction.employeeId, tx);
  if (!open || open.workDate !== correction.workDate) return;
  await attendanceSessionRepository.markClosed(tx, open.id, correction.correctedValue);
}

/**
 * The read half of the daily calculation: gathers sessions, approved corrections, the Workforce
 * day context and the company policy, and runs the ONE calculation engine. Persists nothing —
 * `recalculateDailyRecordInternal` upserts its result (recalculation) and
 * `materializeMissingDailyRecord` inserts it only if no record exists (scheduled processing).
 * Scoped by `companyId` rather than a `RequestContext` so the scheduled job needs no user identity.
 * It performs no permission check, so every caller must already have authorized the action.
 */
async function computeDailyResult(
  companyId: string,
  employeeId: string,
  workDate: string,
  executor: DbExecutor,
  preloadedDayInfo?: WorkforceDayInfo,
): Promise<DailyCalculationResult> {
  const sessions = await buildSessionInputs(employeeId, workDate, executor);

  // Batch 12 — the company policy is loaded exactly once here (the one path shared by check-out,
  // manual recalculation, correction approval, day processing and scheduled materialization) and
  // passed down, never re-read per correction or per caller. It applies to this calculation only;
  // see attendance-policy.service.ts.
  const policy = await resolveAttendancePolicy(companyId, workDate, executor);

  // Only APPROVED corrections may affect calculation — PENDING/REJECTED never reach this list
  // (see attendanceCorrectionRepository.listApprovedForWorkDate). This is the one authoritative
  // calculation path, so every caller can never disagree.
  const approvedCorrections = await attendanceCorrectionRepository.listApprovedForWorkDate(employeeId, workDate, executor);
  const overrides = await Promise.all(approvedCorrections.map((correction) => buildCorrectionOverride(companyId, correction, executor, policy)));
  const correctedSessions = applyCorrectionsToSessions(sessions, overrides);

  const dayInfo = preloadedDayInfo ?? (await resolveWorkforceDayInfo(companyId, employeeId, workDate));
  const window = dayInfo.expectedWindow;

  const dayContext: DailyWorkforceContext = {
    isHoliday: dayInfo.isHoliday,
    isWeeklyOff: dayInfo.isWeeklyOff,
    isWorkingDay: dayInfo.isWorkingDay,
    expectedStartAt: window ? zonedWallTimeToUtc(window.start.date, window.start.time, dayInfo.timezone) : null,
    expectedEndAt: window ? zonedWallTimeToUtc(window.end.date, window.end.time, dayInfo.timezone) : null,
    gracePeriodMinutes: dayInfo.scheduleAssignment?.shift?.gracePeriodMinutes ?? policy.defaultGracePeriodMinutes,
  };

  return calculateDailyAttendance(correctedSessions, dayContext, policy);
}

/**
 * Calculates and upserts the day's record. Always inside a transaction (the type enforces it) and
 * always under the per-(employee, work date) day lock, taken BEFORE the inputs are read so the
 * calculation can never be based on a state another writer is about to change (F-01).
 */
async function recalculateDailyRecordInternal(
  companyId: string,
  employeeId: string,
  workDate: string,
  executor: Transaction,
  preloadedDayInfo?: WorkforceDayInfo,
): Promise<AttendanceDailyRecord> {
  await lockAttendanceDay(executor, employeeId, workDate);
  const result = await computeDailyResult(companyId, employeeId, workDate, executor, preloadedDayInfo);

  return attendanceDailyRecordRepository.upsert(executor, {
    companyId,
    employeeId,
    workDate,
    status: result.status,
    scheduledMinutes: result.scheduledMinutes,
    workedMinutes: result.workedMinutes,
    breakMinutes: result.breakMinutes,
    overtimeMinutes: result.overtimeMinutes,
    lateMinutes: result.lateMinutes,
    earlyDepartureMinutes: result.earlyDepartureMinutes,
    firstCheckInAt: result.firstCheckInAt,
    lastCheckOutAt: result.lastCheckOutAt,
    sessionCount: result.sessionCount,
  });
}

export type MaterializeMissingResult = "CREATED" | "SKIPPED_EXISTING";

/**
 * Batch 13 — creates the daily record for (employee, work date) ONLY IF none exists; an existing
 * record is never calculated against, recalculated or modified. Uses the same `computeDailyResult`
 * engine path as every other recalculation, inside one transaction that first takes the period-open
 * SHARE lock (so a closed period is refused with `AttendancePeriodLockedError` and a concurrent
 * close cannot interleave). The insert is `ON CONFLICT DO NOTHING` on the (employee, work date)
 * unique index, so a record written concurrently — e.g. by a check-out — wins and this call
 * reports `SKIPPED_EXISTING`. If this insert lands first, a later check-out's upsert still
 * overwrites it with the correct figures, so the final state is always right.
 *
 * Internal entry point for the scheduled job: there is no end user, hence no permission check. The
 * job derives `companyId` server-side and only passes employees from that company's own eligible
 * list; `computeDailyResult` additionally rejects an employee outside `companyId`.
 */
export async function materializeMissingDailyRecord(companyId: string, employeeId: string, workDate: string): Promise<MaterializeMissingResult> {
  return db.transaction(async (tx) => {
    await assertAttendancePeriodOpen(companyId, workDate, tx);
    // F-01 - same per-(employee, work date) lock as every other daily-record writer, taken before the
    // existence check and the calculation so a concurrent punch cannot be missed.
    await lockAttendanceDay(tx, employeeId, workDate);

    if (await attendanceDailyRecordRepository.findOne(employeeId, workDate, tx)) return "SKIPPED_EXISTING";

    const result = await computeDailyResult(companyId, employeeId, workDate, tx);
    const inserted = await attendanceDailyRecordRepository.insertIfAbsent(tx, {
      companyId,
      employeeId,
      workDate,
      status: result.status,
      scheduledMinutes: result.scheduledMinutes,
      workedMinutes: result.workedMinutes,
      breakMinutes: result.breakMinutes,
      overtimeMinutes: result.overtimeMinutes,
      lateMinutes: result.lateMinutes,
      earlyDepartureMinutes: result.earlyDepartureMinutes,
      firstCheckInAt: result.firstCheckInAt,
      lastCheckOutAt: result.lastCheckOutAt,
      sessionCount: result.sessionCount,
    });
    return inserted ? "CREATED" : "SKIPPED_EXISTING";
  });
}

/** Explicit, permission-gated recalculation (e.g. after a correction is approved, or an HR-
 *  triggered "recompute this day" action). Internally, check-out already triggers this
 *  automatically for immediate feedback — this is the externally callable form. */
export async function recalculateDailyRecord(ctx: RequestContext, requestedEmployeeId: string, workDate: string): Promise<AttendanceDailyRecord> {
  requirePermission(ctx, "attendance.recalculate");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  const employee = await loadEmployeeInCompany(ctx, targetEmployeeId);

  // F-07 - a real date, not in the future for THIS employee's timezone, and not before they joined.
  assertValidWorkDate(workDate);
  assertWorkDateNotInFuture(workDate, await resolveEmployeeTimezone(ctx, targetEmployeeId));
  if (workDate < employee.dateOfJoining) {
    throw new InvalidAttendanceDateError("Attendance cannot be calculated for a date before the employee joined.");
  }

  // Batch 8 — a closed period cannot be recalculated (§15). Wrapped in its own transaction purely
  // to hold the period's SHARE lock for the duration of the write that follows; `recalculateDailyRecordInternal`
  // otherwise has no transactional needs of its own (a single upsert statement is already atomic).
  const record = await db.transaction(async (tx) => {
    await assertAttendancePeriodOpen(ctx.companyId, workDate, tx);
    return recalculateDailyRecordInternal(ctx.companyId, targetEmployeeId, workDate, tx);
  });
  await recordAuditLog(ctx, {
    action: "attendance.recalculate",
    entityType: "attendance_daily_record",
    entityId: record.id,
    newData: record,
    metadata: { employeeId: targetEmployeeId, workDate },
  });
  return record;
}

/** Returns the day's record plus that date's sessions, each enriched with its own display-only
 *  duration (see `AttendanceSessionView`) — never the source of the day's authoritative totals.
 *
 *  F-01 — strictly READ-ONLY. A stored record is returned exactly as stored. With no stored record:
 *  a CLOSED period returns the synthetic `"UNPROCESSED"` stand-in (Batch 8), and an open period
 *  returns the engine's result calculated in memory as a provisional record (`id: null`). Nothing
 *  here ever writes `attendance_daily_records`; see `recalculateDailyRecordInternal` for who does. */
export async function getAttendanceDay(
  ctx: RequestContext,
  requestedEmployeeId: string,
  workDate: string,
): Promise<{ record: AttendanceDayRecord; sessions: AttendanceSessionView[] }> {
  requirePermission(ctx, "attendance.view");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  await loadEmployeeInCompany(ctx, targetEmployeeId);
  assertValidWorkDate(workDate); // a read may look at any real date (future dates give a provisional view), never a malformed one

  const rawSessions = await attendanceSessionRepository.listForEmployeeWorkDate(targetEmployeeId, workDate);
  const sessions = await Promise.all(rawSessions.map(toSessionView));

  const existing = await attendanceDailyRecordRepository.findOne(targetEmployeeId, workDate);
  if (existing) {
    return { record: existing, sessions };
  }

  if (await isAttendancePeriodClosed(ctx.companyId, workDate.slice(0, 7))) {
    return {
      record: {
        companyId: ctx.companyId,
        employeeId: targetEmployeeId,
        workDate,
        id: null,
        status: "UNPROCESSED",
        scheduledMinutes: 0,
        workedMinutes: null,
        breakMinutes: 0,
        overtimeMinutes: null,
        lateMinutes: null,
        earlyDepartureMinutes: null,
        firstCheckInAt: null,
        lastCheckOutAt: null,
        sessionCount: 0,
        calculatedAt: null,
        createdAt: null,
        updatedAt: null,
      },
      sessions,
    };
  }

  // F-01 - a read never writes. No stored record (open period): calculate the day in memory and
  // return it as a provisional record (`id: null`). Stored records are created by check-out, explicit
  // HR actions, correction approval and the scheduled job only.
  const result = await computeDailyResult(ctx.companyId, targetEmployeeId, workDate, db);
  return {
    record: {
      companyId: ctx.companyId,
      employeeId: targetEmployeeId,
      workDate,
      id: null,
      status: result.status,
      scheduledMinutes: result.scheduledMinutes,
      workedMinutes: result.workedMinutes,
      breakMinutes: result.breakMinutes,
      overtimeMinutes: result.overtimeMinutes,
      lateMinutes: result.lateMinutes,
      earlyDepartureMinutes: result.earlyDepartureMinutes,
      firstCheckInAt: result.firstCheckInAt,
      lastCheckOutAt: result.lastCheckOutAt,
      sessionCount: result.sessionCount,
      calculatedAt: null,
      createdAt: null,
      updatedAt: null,
    },
    sessions,
  };
}

export async function listAttendanceForEmployee(
  ctx: RequestContext,
  requestedEmployeeId: string,
  from: string,
  to: string,
): Promise<AttendanceDailyRecord[]> {
  requirePermission(ctx, "attendance.view");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  await loadEmployeeInCompany(ctx, targetEmployeeId);
  return attendanceDailyRecordRepository.listForEmployeeRange(targetEmployeeId, from, to);
}

// ---------------------------------------------------------------------------
// Corrections (Batch 4) — original attendance_events are immutable; a correction never mutates or
// deletes one. It becomes effective only once APPROVED, at which point it is fed into the
// calculation engine as an override input (see `applyCorrectionsToSessions`) and the affected
// day is recalculated in the same transaction that approves it (§7) — never a synthetic event.
// ---------------------------------------------------------------------------

/**
 * Batch 11 hardening — nothing previously checked that a correction's proposed value keeps its
 * target session's own event ordering valid (check-in before check-out, break-start before
 * break-end). Without this, an out-of-order value (e.g. a CHECK_OUT corrected to a time before
 * its session's CHECK_IN) would be accepted at request time and, once approved, silently produce
 * a negative `workedMinutes`/`breakMinutes` the next time `calculateDailyAttendance` runs —
 * `diffMinutes` has no floor at zero. Compared only against the target session's OTHER,
 * uncorrected timestamps (never against the value this same correction is replacing). Deliberately
 * request-time only, not re-checked on every later recalculation — re-validating at every
 * recalculation would let unrelated future activity permanently break recalculation for a day
 * whose correction was valid when it was approved, which is a worse failure mode than the narrow,
 * harder-to-hit race this doesn't cover (further attendance activity changing the comparison
 * timestamp between this request and its eventual approval).
 */
async function assertCorrectionTimestampOrdering(
  fieldChanged: AttendanceCorrectionField,
  correctedValue: Date,
  sessionId: string | null,
  eventId: string | null,
  executor: DbExecutor,
): Promise<void> {
  if (!sessionId) return; // Missing-punch CHECK_IN with no session yet — nothing to compare against.
  const session = await attendanceSessionRepository.findById(sessionId, executor);
  if (!session) return;

  if (fieldChanged === "CHECK_IN") {
    if (session.checkOutAt && correctedValue.getTime() >= session.checkOutAt.getTime()) {
      throw new InvalidCorrectionTargetError("The corrected check-in time must be before this session's check-out time.");
    }
    return;
  }

  if (fieldChanged === "CHECK_OUT") {
    if (correctedValue.getTime() <= session.checkInAt.getTime()) {
      throw new InvalidCorrectionTargetError("The corrected check-out time must be after this session's check-in time.");
    }
    return;
  }

  // BREAK_START / BREAK_END: compare against the specific break pair this correction targets.
  // For a missing-punch BREAK_END (eventId null), the open break's own endEventId is also null,
  // so it is still found correctly — resolveMissingPunchSessionId already confirmed it is unique.
  const breaks = await attendanceEventRepository.listBreaksForSession(sessionId, executor);
  const brk = breaks.find((b) => b.startEventId === eventId || b.endEventId === eventId);
  if (!brk) return;

  if (fieldChanged === "BREAK_START") {
    if (correctedValue.getTime() <= session.checkInAt.getTime()) {
      throw new InvalidCorrectionTargetError("The corrected break-start time must be after this session's check-in time.");
    }
    if (brk.endAt && correctedValue.getTime() >= brk.endAt.getTime()) {
      throw new InvalidCorrectionTargetError("The corrected break-start time must be before this break's end time.");
    }
  } else if (fieldChanged === "BREAK_END") {
    if (correctedValue.getTime() <= brk.startAt.getTime()) {
      throw new InvalidCorrectionTargetError("The corrected break-end time must be after this break's start time.");
    }
    if (session.checkOutAt && correctedValue.getTime() >= session.checkOutAt.getTime()) {
      throw new InvalidCorrectionTargetError("The corrected break-end time must be before this session's check-out time.");
    }
  }
}

export async function requestCorrection(
  ctx: RequestContext,
  requestedEmployeeId: string,
  input: RequestCorrectionInput,
): Promise<AttendanceCorrection> {
  requirePermission(ctx, "attendance.correction.request");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  await loadEmployeeInCompany(ctx, targetEmployeeId);

  // The corrected instant, read back in the employee's own timezone, must fall on the work date
  // being corrected or (for an overnight shift's checkout/break-end) the day right after it —
  // never silently reinterpreted, since z.iso.datetime({ offset: true }) already requires the
  // client to supply an explicit, unambiguous UTC offset.
  const timezone = await resolveEmployeeTimezone(ctx, targetEmployeeId);
  // F-07 - nothing can be corrected on a date that has not happened, and a corrected time cannot be in
  // the future (the server's clock decides, not the browser's).
  assertWorkDateNotInFuture(input.workDate, timezone);
  if (input.correctedValue.getTime() > Date.now() + CORRECTION_TIME_TOLERANCE_MS) {
    throw new InvalidAttendanceDateError("A corrected time cannot be in the future.");
  }
  const zoned = utcToZonedWallTime(input.correctedValue, timezone);
  if (zoned.date !== input.workDate && zoned.date !== addDays(input.workDate, 1)) {
    throw new InvalidCorrectionTargetError(
      "The corrected time, read in the employee's timezone, falls outside the work date being corrected (or the day immediately after it, for an overnight shift).",
    );
  }

  // Batch 8 — wrapped in a transaction (this function previously used no transaction at all) so
  // the period SHARE lock is held from the very first check through the final INSERT below, not
  // just for one isolated read (§24 race safety).
  const { correction, created } = await db.transaction(async (tx) => {
    await assertAttendancePeriodOpen(ctx.companyId, input.workDate, tx);
    // F-09 - serialize requests for the same employee/work date on the shared day lock (period -> day).
    // The conflict check below is a plain SELECT; without this, two simultaneous requests for the same
    // target both pass it and both insert (the period SHARE lock above is compatible with itself).
    await lockAttendanceDay(tx, targetEmployeeId, input.workDate);

    let eventId: string | null = null;
    let originalValue: Date | null = null;
    let sessionId: string | null = null;

    if (input.eventId) {
      const event = await resolveCorrectionEventTarget(ctx, targetEmployeeId, input.workDate, input.fieldChanged, input.eventId, tx);
      eventId = event.id;
      originalValue = event.occurredAt;
      sessionId = event.sessionId;
    } else {
      // Confirms exactly one legitimate missing-punch target exists right now. The resolved
      // target itself isn't stored on the correction — `buildCorrectionOverride` re-resolves it
      // at approval time, since more attendance activity may have happened between request and review.
      sessionId = await resolveMissingPunchSessionId(targetEmployeeId, input.workDate, input.fieldChanged, tx);
    }

    await assertCorrectionTimestampOrdering(input.fieldChanged, input.correctedValue, sessionId, eventId, tx);

    // §14: two corrections may never both end up APPROVED for the same logical (employeeId,
    // workDate, fieldChanged, eventId) target — reject a new request that would conflict with an
    // existing PENDING or APPROVED one rather than silently choosing one.
    const conflict = await attendanceCorrectionRepository.findConflicting(targetEmployeeId, input.workDate, input.fieldChanged, eventId, tx);
    if (conflict) {
      // F-09 - the SAME request repeated (a double-click, a browser/API retry after a timeout): same
      // requester, still PENDING, identical corrected time and reason. It is that request, not a new one,
      // so return the original and write nothing - no second row and no second audit entry. Anything else
      // on the same target (a different value, another requester, an already-reviewed one) is a genuine
      // conflict and stays refused.
      const isReplay =
        conflict.status === "PENDING" &&
        conflict.requestedByUserId === ctx.userId &&
        conflict.correctedValue.getTime() === input.correctedValue.getTime() &&
        conflict.reason === input.reason;
      if (isReplay) return { correction: conflict, created: false };
      throw new ConflictingCorrectionError();
    }

    const inserted = await attendanceCorrectionRepository.create(
      {
        companyId: ctx.companyId,
        employeeId: targetEmployeeId,
        workDate: input.workDate,
        eventId,
        fieldChanged: input.fieldChanged,
        originalValue,
        correctedValue: input.correctedValue,
        requestedByUserId: ctx.userId,
        reason: input.reason,
      },
      tx,
    );
    return { correction: inserted, created: true };
  });

  if (created) {
    await recordAuditLog(ctx, {
      action: "attendance.correction.create",
      entityType: "attendance_correction",
      entityId: correction.id,
      newData: correction,
      metadata: { employeeId: targetEmployeeId },
    });
  }
  return correction;
}

export async function listCorrectionsForEmployee(ctx: RequestContext, requestedEmployeeId: string): Promise<AttendanceCorrectionWithDetails[]> {
  requirePermission(ctx, "attendance.view");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  await loadEmployeeInCompany(ctx, targetEmployeeId);
  return attendanceCorrectionRepository.listForEmployee(targetEmployeeId);
}

/**
 * Batch 12 — visibility is unchanged (still every correction in the caller's own company, gated
 * on the same `attendance.correction.approve` permission as before — a user may see a correction
 * even when they cannot act on it). What's new is `canReview` per row: the same self-approval +
 * approval-hierarchy policy `reviewCorrection` enforces, computed once here so the UI never has
 * to recreate that policy independently. Resolved with one batched
 * `findActiveRolesForUsers` call for the whole page, not one lookup per row.
 */
export async function listCompanyCorrections(
  ctx: RequestContext,
  status?: "PENDING" | "APPROVED" | "REJECTED",
): Promise<AttendanceCorrectionQueueItem[]> {
  requirePermission(ctx, "attendance.correction.approve");
  const corrections = await attendanceCorrectionRepository.listForCompany(ctx.companyId, status);

  const requesterIds = [...new Set(corrections.map((c) => c.requestedByUserId).filter((id): id is string => id !== null))];
  const requesterRoles = await attendanceCorrectionRepository.findActiveRolesForUsers(ctx.companyId, requesterIds);

  return corrections.map((correction) => {
    if (correction.requestedByUserId === ctx.userId) {
      return { ...correction, canReview: false };
    }
    const requesterRole = correction.requestedByUserId ? requesterRoles.get(correction.requestedByUserId) : undefined;
    // No resolvable current role for the requester (e.g. their membership was deactivated) —
    // fall back to the existing permission-only model rather than blocking a correction that can
    // then never be reviewed by anyone.
    const canReview = !requesterRole || canReviewAttendanceCorrection(requesterRole, ctx.role);
    return { ...correction, canReview };
  });
}

/** A single correction's detail — for the HR review UI and an employee checking their own
 *  request. EMPLOYEE is restricted to their own record; every other role that can reach this at
 *  all is already scoped to their own company via `assertCompanyAccess`. */
export async function getCorrectionDetail(ctx: RequestContext, correctionId: string): Promise<AttendanceCorrectionWithDetails> {
  requirePermission(ctx, "attendance.view");
  const correction = await attendanceCorrectionRepository.findByIdWithDetails(correctionId);
  if (!correction) throw new AttendanceCorrectionNotFoundError();
  assertCompanyAccess(ctx, correction.companyId);
  if (ctx.role === "EMPLOYEE" && correction.employeeId !== ctx.employeeId) {
    throw new AuthorizationError("You may only view your own attendance corrections.");
  }
  return correction;
}

/**
 * Approval/rejection is one transactional state transition (§7): lock the correction row (so a
 * concurrent second reviewer blocks rather than racing — §8), verify it is still PENDING, apply
 * the transition, and — for an approval — recalculate the affected day *inside the same
 * transaction*. If recalculation throws, the whole transaction (including the status change)
 * rolls back, so a correction can never end up APPROVED while its derived daily record is stale.
 *
 * Batch 12 — two additional checks sit between the period-lock check and the actual transition:
 * the requester may never review their own correction (a same-user comparison, deliberately never
 * role-based — see `SelfApprovalNotAllowedError`, and note this makes self-approval impossible
 * even if the requester's role changes before review, since `requestedByUserId` never changes),
 * and the reviewer's CURRENT role must meet the minimum approval hierarchy for the requester's
 * CURRENT role (`canReviewAttendanceCorrection` in rbac.ts) — resolved fresh here, never from
 * anything cached on the correction row, so a role change between request and review is always
 * honored correctly in either direction.
 */
async function reviewCorrection(
  ctx: RequestContext,
  correctionId: string,
  status: "APPROVED" | "REJECTED",
  input: ReviewCorrectionInput,
): Promise<AttendanceCorrection> {
  const correction = await db.transaction(async (tx) => {
    const existing = await attendanceCorrectionRepository.findByIdLocked(correctionId, tx);
    if (!existing) throw new AttendanceCorrectionNotFoundError();
    assertCompanyAccess(ctx, existing.companyId);
    if (existing.status !== "PENDING") throw new CorrectionAlreadyReviewedError();
    // Batch 8 (§11/§13) — "closed period = no correction lifecycle mutations" applies to both
    // approval and rejection; a PENDING correction against a now-closed period can be reviewed
    // by neither. An already-APPROVED correction from before the close is left untouched (this
    // only ever runs while status is still PENDING, per the check just above).
    await assertAttendancePeriodOpen(ctx.companyId, existing.workDate, tx);

    if (existing.requestedByUserId === ctx.userId) {
      throw new SelfApprovalNotAllowedError();
    }

    if (existing.requestedByUserId) {
      const requesterRoles = await attendanceCorrectionRepository.findActiveRolesForUsers(ctx.companyId, [existing.requestedByUserId], tx);
      const requesterRole = requesterRoles.get(existing.requestedByUserId);
      // No resolvable current role (e.g. the requester's membership was deactivated) — fall back
      // to the existing permission-only model rather than leaving the correction unreviewable by
      // anyone; `requirePermission` above this function already confirmed `ctx.role` holds
      // `attendance.correction.approve`/`.reject`.
      if (requesterRole && !canReviewAttendanceCorrection(requesterRole, ctx.role)) {
        throw new InsufficientCorrectionApprovalAuthorityError();
      }
    }

    const reviewed = await attendanceCorrectionRepository.review(
      correctionId,
      { status, reviewedByUserId: ctx.userId, reviewNote: input.reviewNote ?? null },
      tx,
    );

    if (status === "APPROVED") {
      try {
        if (existing.fieldChanged === "CHECK_OUT" && existing.eventId === null) {
          await closeSessionResolvedByCorrection(existing, tx);
        }
        await recalculateDailyRecordInternal(ctx.companyId, existing.employeeId, existing.workDate, tx);
      } catch {
        throw new RecalculationFailedError();
      }
    }

    return reviewed;
  });

  await recordAuditLog(ctx, {
    action: status === "APPROVED" ? "attendance.correction.approve" : "attendance.correction.reject",
    entityType: "attendance_correction",
    entityId: correction.id,
    oldData: { status: "PENDING" },
    newData: correction,
    metadata: { employeeId: correction.employeeId, workDate: correction.workDate, requestedByUserId: correction.requestedByUserId },
  });
  return correction;
}

export async function approveCorrection(
  ctx: RequestContext,
  correctionId: string,
  input: ReviewCorrectionInput = {},
): Promise<AttendanceCorrection> {
  requirePermission(ctx, "attendance.correction.approve");
  return reviewCorrection(ctx, correctionId, "APPROVED", input);
}

export async function rejectCorrection(
  ctx: RequestContext,
  correctionId: string,
  input: ReviewCorrectionInput = {},
): Promise<AttendanceCorrection> {
  requirePermission(ctx, "attendance.correction.reject");
  return reviewCorrection(ctx, correctionId, "REJECTED", input);
}

// ---------------------------------------------------------------------------
// HR/Manager dashboard (Batch 3) — read-only. Every figure below is read directly off
// attendance_daily_records / attendance_open_sessions; nothing here recomputes a status, a late/
// early/overtime value, or Workforce precedence. See repository.ts's dashboard section for the
// bounded-query design (paginated join for the table, small targeted queries for the
// late/incomplete/currently-working lists).
// ---------------------------------------------------------------------------

const ALL_DAILY_STATUSES = attendanceDailyStatusEnum.enumValues;
const DASHBOARD_MAX_PAGE_SIZE = 100;
const DASHBOARD_DEFAULT_PAGE_SIZE = 25;

type EmployeeLike = {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  department: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
};

function toEmployeeSummary(employee: EmployeeLike) {
  return {
    id: employee.id,
    employeeNumber: employee.employeeNumber,
    firstName: employee.firstName,
    lastName: employee.lastName,
    department: employee.department,
    location: employee.location,
  };
}

/** Reduces a break-event stream to per-session state in one pass — reused by the dashboard so the
 *  "Currently Working" section never calls `findOpenBreak` once per row (N+1). */
function summarizeBreaksBySession(events: AttendanceEvent[]): Map<string, { hasOpenBreak: boolean; closedMinutes: number }> {
  const bySession = new Map<string, { startAt: Date; endAt: Date | null }[]>();
  for (const event of events) {
    const list = bySession.get(event.sessionId) ?? [];
    if (event.eventType === "BREAK_START") {
      list.push({ startAt: event.occurredAt, endAt: null });
    } else if (event.eventType === "BREAK_END") {
      const open = [...list].reverse().find((b) => b.endAt === null);
      if (open) open.endAt = event.occurredAt;
    }
    bySession.set(event.sessionId, list);
  }
  const result = new Map<string, { hasOpenBreak: boolean; closedMinutes: number }>();
  for (const [sessionId, breaks] of bySession) {
    result.set(sessionId, { hasOpenBreak: breaks.some((b) => b.endAt === null), closedMinutes: closedBreakMinutes(breaks) });
  }
  return result;
}

/**
 * `EMPLOYEE` is explicitly rejected here (not just left ungated) — that role already holds
 * `attendance.view` for its own self-service use in `/attendance`, so the permission check alone
 * would not exclude it. The dashboard page also redirects EMPLOYEE before ever reaching this
 * call, but the service enforces it independently — the server must not rely on the page alone.
 */
export async function getAttendanceDashboard(ctx: RequestContext, filters: AttendanceDashboardFilters): Promise<AttendanceDashboardResult> {
  requirePermission(ctx, "attendance.view");
  if (ctx.role === "EMPLOYEE") {
    throw new AuthorizationError("The attendance dashboard is not available to this role.");
  }

  const clamped: AttendanceDashboardFilters = {
    ...filters,
    page: Math.max(1, filters.page || 1),
    pageSize: Math.min(DASHBOARD_MAX_PAGE_SIZE, Math.max(1, filters.pageSize || DASHBOARD_DEFAULT_PAGE_SIZE)),
  };

  const [totalEmployees, statusCountRows, tableRows, tableTotal, sessionsForDate, lateRecords, incompleteRecords, currentlyWorkingSessions] =
    await Promise.all([
      attendanceDashboardRepository.countActiveEmployees(ctx.companyId),
      attendanceDashboardRepository.getStatusCounts(ctx.companyId, clamped.workDate),
      attendanceDashboardRepository.listTableRows(ctx.companyId, clamped.workDate, clamped),
      attendanceDashboardRepository.countTableRows(ctx.companyId, clamped.workDate, clamped),
      attendanceDashboardRepository.listSessionsForWorkDate(ctx.companyId, clamped.workDate),
      attendanceDashboardRepository.listRecordsByStatus(ctx.companyId, clamped.workDate, "LATE"),
      attendanceDashboardRepository.listRecordsByStatus(ctx.companyId, clamped.workDate, "INCOMPLETE"),
      attendanceDashboardRepository.listCurrentlyWorking(ctx.companyId),
    ]);

  const statusCounts = Object.fromEntries(ALL_DAILY_STATUSES.map((status) => [status, 0])) as Record<AttendanceDailyStatus, number>;
  for (const row of statusCountRows) statusCounts[row.status] = row.value;
  const recordedCount = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
  const employeesWithoutRecord = Math.max(0, totalEmployees - recordedCount);

  // The first session that captured each employee's snapshot for this date — display only
  // (Schedule/Shift columns), never used for any minute/status calculation.
  const firstSessionByEmployee = new Map<string, (typeof sessionsForDate)[number]>();
  for (const session of sessionsForDate) {
    if (!firstSessionByEmployee.has(session.employeeId)) firstSessionByEmployee.set(session.employeeId, session);
  }

  const table: AttendanceDashboardResult["table"] = {
    items: tableRows.map((row): AttendanceDashboardRow => {
      const firstSession = firstSessionByEmployee.get(row.employee.id) ?? null;
      return {
        ...toEmployeeSummary({
          ...row.employee,
          department: row.department ? { id: row.department.id, name: row.department.name } : null,
          location: row.location ? { id: row.location.id, name: row.location.name } : null,
        }),
        record: row.record,
        scheduleName: firstSession?.expectedWorkSchedule?.name ?? null,
        shiftName: firstSession?.expectedShift?.name ?? null,
        timezone: firstSession?.resolvedTimezone ?? null,
      };
    }),
    total: tableTotal,
    page: clamped.page,
    pageSize: clamped.pageSize,
  };

  async function toRecordRows<T extends { employeeId: string }>(
    records: T[],
  ): Promise<{ employee: Awaited<ReturnType<typeof attendanceDashboardRepository.listByIds>>[number]; record: T }[]> {
    const employeesById = new Map(
      (await attendanceDashboardRepository.listByIds(ctx.companyId, records.map((r) => r.employeeId))).map((e) => [e.id, e]),
    );
    return records.filter((r) => employeesById.has(r.employeeId)).map((record) => ({ employee: employeesById.get(record.employeeId)!, record }));
  }

  const lateJoined = await toRecordRows(lateRecords);
  const lateArrivals: LateArrivalRow[] = lateJoined
    .sort((a, b) => (b.record.lateMinutes ?? 0) - (a.record.lateMinutes ?? 0))
    .map(({ employee, record }) => {
      const firstSession = firstSessionByEmployee.get(employee.id) ?? null;
      return {
        ...toEmployeeSummary(employee),
        record,
        scheduleName: firstSession?.expectedWorkSchedule?.name ?? null,
        shiftName: firstSession?.expectedShift?.name ?? null,
        timezone: firstSession?.resolvedTimezone ?? null,
      };
    });

  const incompleteJoined = await toRecordRows(incompleteRecords);
  const incompleteAttendance: IncompleteAttendanceRow[] = incompleteJoined
    .sort((a, b) => (a.record.firstCheckInAt?.getTime() ?? 0) - (b.record.firstCheckInAt?.getTime() ?? 0))
    .map(({ employee, record }) => {
      const firstSession = firstSessionByEmployee.get(employee.id) ?? null;
      return {
        ...toEmployeeSummary(employee),
        record,
        scheduleName: firstSession?.expectedWorkSchedule?.name ?? null,
        shiftName: firstSession?.expectedShift?.name ?? null,
        timezone: firstSession?.resolvedTimezone ?? null,
      };
    });

  const workingEmployeesById = new Map(
    (await attendanceDashboardRepository.listByIds(ctx.companyId, currentlyWorkingSessions.map((s) => s.employeeId))).map((e) => [e.id, e]),
  );
  const breakEvents = await attendanceEventRepository.listBreakEventsForSessions(currentlyWorkingSessions.map((s) => s.id));
  const breakStateBySession = summarizeBreaksBySession(breakEvents);

  const currentlyWorking: CurrentlyWorkingRow[] = currentlyWorkingSessions
    .filter((session) => workingEmployeesById.has(session.employeeId))
    .map((session) => {
      const employee = workingEmployeesById.get(session.employeeId)!;
      const breakState = breakStateBySession.get(session.id) ?? { hasOpenBreak: false, closedMinutes: 0 };
      // No per-break intervals here — deliberately: this row comes from the dashboard's bulk
      // `summarizeBreaksBySession` (one query for every currently-working session's break totals,
      // not one `listBreaksForSession` call per row). `CurrentlyWorkingTable` never reads
      // `.breaks`; an empty array is accurate for what this call site actually has, not a stand-in
      // for a second per-session query.
      const sessionView: AttendanceSessionView = {
        ...session,
        sessionBreakMinutes: breakState.closedMinutes,
        sessionWorkedMinutes: null,
        breaks: [],
      };
      return { ...toEmployeeSummary(employee), session: sessionView, hasOpenBreak: breakState.hasOpenBreak };
    });

  return {
    summary: { workDate: clamped.workDate, totalEmployees, statusCounts, employeesWithoutRecord },
    currentlyWorking,
    lateArrivals,
    incompleteAttendance,
    table,
  };
}

/**
 * F-01 repair entry point (see `scripts/repair-attendance-daily-records.ts`): recalculates an
 * EXISTING daily record through the one calculation engine, under the same day lock and period guard
 * as every other writer. Never creates a record and never touches a closed period. System-scoped (no
 * end user), so it performs no permission check — it is not exposed to any request handler.
 */
export async function recalculateExistingDailyRecordForRepair(
  companyId: string,
  employeeId: string,
  workDate: string,
): Promise<"REPAIRED" | "SKIPPED_CLOSED" | "NO_RECORD"> {
  try {
    return await db.transaction(async (tx) => {
      await assertAttendancePeriodOpen(companyId, workDate, tx);
      await lockAttendanceDay(tx, employeeId, workDate);
      if (!(await attendanceDailyRecordRepository.findOne(employeeId, workDate, tx))) return "NO_RECORD" as const;
      await recalculateDailyRecordInternal(companyId, employeeId, workDate, tx);
      return "REPAIRED" as const;
    });
  } catch (error) {
    if (error instanceof AttendancePeriodLockedError) return "SKIPPED_CLOSED";
    throw error;
  }
}
