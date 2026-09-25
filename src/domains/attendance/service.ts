import { attendanceDailyStatusEnum } from "@/db/schema";
import { db } from "@/db/client";
import type { RequestContext } from "@/lib/auth/request-context";
import { assertCompanyAccess, requirePermission } from "@/lib/auth/request-context";
import { AuthorizationError, isUniqueViolation } from "@/lib/errors";
import { recordAuditLog } from "@/domains/audit/service";
import { employeeRepository } from "@/domains/employee/repository";
import { EmployeeNotFoundError } from "@/domains/employee/errors";
import { getWorkforceDayInfo, resolveEmployeeTimezone } from "@/domains/workforce/service";
import { addDays, utcToZonedWallTime, zonedWallTimeToUtc } from "@/lib/datetime";
import { applyCorrectionsToSessions, calculateDailyAttendance, closedBreakMinutes, diffMinutes } from "./calculation";
import { assertAttendancePeriodOpen, isAttendancePeriodClosed } from "./periods/attendance-period.service";
import {
  attendanceCorrectionRepository,
  attendanceDailyRecordRepository,
  attendanceDashboardRepository,
  attendanceEventRepository,
  attendanceSessionRepository,
} from "./repository";
import {
  AlreadyCheckedInError,
  AttendanceCorrectionNotFoundError,
  ConflictingCorrectionError,
  CorrectionAlreadyReviewedError,
  DuplicateAttendanceEventError,
  InvalidCorrectionEventError,
  InvalidCorrectionTargetError,
  NoOpenBreakError,
  NoOpenSessionError,
  OpenBreakExistsError,
  RecalculationFailedError,
} from "./errors";
import type {
  AttendanceCorrection,
  AttendanceCorrectionField,
  AttendanceCorrectionOverride,
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
import type { DbExecutor } from "@/db/client";

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

  const dayInfo = await getWorkforceDayInfo(ctx, employeeId, workDate);
  const window = dayInfo.expectedWindow;
  return {
    workDate,
    dayInfo,
    expectedStartAt: window ? zonedWallTimeToUtc(window.start.date, window.start.time, dayInfo.timezone) : null,
    expectedEndAt: window ? zonedWallTimeToUtc(window.end.date, window.end.time, dayInfo.timezone) : null,
    gracePeriodMinutes: dayInfo.scheduleAssignment?.shift?.gracePeriodMinutes ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Check-in / check-out / breaks
// ---------------------------------------------------------------------------

export async function checkIn(ctx: RequestContext, requestedEmployeeId: string, input: CheckInInput = {}): Promise<AttendanceSession> {
  requirePermission(ctx, "attendance.check_in");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  await loadEmployeeInCompany(ctx, targetEmployeeId);

  if (input.idempotencyKey) {
    const existingEvent = await attendanceEventRepository.findByIdempotencyKey(targetEmployeeId, input.idempotencyKey);
    if (existingEvent) {
      const existingSession = await attendanceSessionRepository.findById(existingEvent.sessionId);
      if (existingSession) return existingSession;
    }
  }

  const occurredAt = new Date();
  const { workDate, dayInfo, expectedStartAt, expectedEndAt, gracePeriodMinutes } = await resolveCheckInContext(ctx, targetEmployeeId, occurredAt);

  const session = await db.transaction(async (tx) => {
    // Batch 8 — must be the first thing this transaction does: the SHARE lock it takes on the
    // period row is what makes this check race-safe against a concurrent close (see
    // attendance-period.repository.ts's module doc).
    await assertAttendancePeriodOpen(ctx.companyId, workDate, tx);

    // Row-locked implicitly by the partial unique index on (employeeId) WHERE status='OPEN' — a
    // concurrent duplicate check-in racing this same check fails on that constraint below, not on
    // an explicit SELECT ... FOR UPDATE (there is no existing row to lock for a brand-new session).
    const openExisting = await attendanceSessionRepository.findOpenForEmployeeLocked(targetEmployeeId, tx);
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
      await recordAuditLog(ctx, {
        action: "attendance.session.abandon",
        entityType: "attendance_session",
        entityId: openExisting.id,
        oldData: { status: openExisting.status, workDate: openExisting.workDate },
        newData: { status: "ABANDONED" },
        metadata: { employeeId: targetEmployeeId, supersededByWorkDate: workDate },
      });
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

      return newSession;
    } catch (error) {
      if (isUniqueViolation(error)) throw new AlreadyCheckedInError();
      throw error;
    }
  });

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
    const existingEvent = await attendanceEventRepository.findByIdempotencyKey(targetEmployeeId, input.idempotencyKey);
    if (existingEvent) {
      const existingSession = await attendanceSessionRepository.findById(existingEvent.sessionId);
      if (existingSession) return existingSession;
    }
  }

  const occurredAt = new Date();

  const session = await db.transaction(async (tx) => {
    const open = await attendanceSessionRepository.findOpenForEmployeeLocked(targetEmployeeId, tx);
    if (!open) throw new NoOpenSessionError();
    await assertAttendancePeriodOpen(ctx.companyId, open.workDate, tx);

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

    return attendanceSessionRepository.markClosed(tx, open.id, occurredAt);
  });

  await recordAuditLog(ctx, {
    action: "attendance.check_out",
    entityType: "attendance_session",
    entityId: session.id,
    newData: session,
    metadata: { employeeId: targetEmployeeId },
  });

  // Triggered synchronously on check-out for immediate feedback, per
  // docs/architecture/attendance-architecture.md's "Attendance Engine" section.
  await recalculateDailyRecordInternal(ctx, targetEmployeeId, session.workDate);

  return session;
}

export async function startBreak(ctx: RequestContext, requestedEmployeeId: string, input: BreakInput = {}): Promise<AttendanceEvent> {
  // Breaks are sub-states of an open session — gated by the same two capabilities that open/close
  // a session (there is no separate attendance.break_* permission in the approved Batch 1 RBAC set).
  requirePermission(ctx, "attendance.check_in");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  await loadEmployeeInCompany(ctx, targetEmployeeId);

  if (input.idempotencyKey) {
    const existing = await attendanceEventRepository.findByIdempotencyKey(targetEmployeeId, input.idempotencyKey);
    if (existing) return existing;
  }

  const occurredAt = new Date();

  const event = await db.transaction(async (tx) => {
    const open = await attendanceSessionRepository.findOpenForEmployeeLocked(targetEmployeeId, tx);
    if (!open) throw new NoOpenSessionError();
    await assertAttendancePeriodOpen(ctx.companyId, open.workDate, tx);
    const openBreak = await attendanceEventRepository.findOpenBreak(open.id, tx);
    if (openBreak) throw new OpenBreakExistsError();

    try {
      return await attendanceEventRepository.create(tx, {
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
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateAttendanceEventError();
      throw error;
    }
  });

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
    const existing = await attendanceEventRepository.findByIdempotencyKey(targetEmployeeId, input.idempotencyKey);
    if (existing) return existing;
  }

  const occurredAt = new Date();

  const event = await db.transaction(async (tx) => {
    const open = await attendanceSessionRepository.findOpenForEmployeeLocked(targetEmployeeId, tx);
    if (!open) throw new NoOpenSessionError();
    await assertAttendancePeriodOpen(ctx.companyId, open.workDate, tx);
    const openBreak = await attendanceEventRepository.findOpenBreak(open.id, tx);
    if (!openBreak) throw new NoOpenBreakError();

    try {
      return await attendanceEventRepository.create(tx, {
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
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateAttendanceEventError();
      throw error;
    }
  });

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
  ctx: RequestContext,
  correction: AttendanceCorrection,
  executor: DbExecutor,
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
    const dayInfo = await getWorkforceDayInfo(ctx, correction.employeeId, correction.workDate);
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
        gracePeriodMinutes: dayInfo.scheduleAssignment?.shift?.gracePeriodMinutes ?? 0,
        isHoliday: dayInfo.isHoliday,
        isWeeklyOff: dayInfo.isWeeklyOff,
        isWorkingDay: dayInfo.isWorkingDay,
      },
    };
  }

  const sessionId = await resolveMissingPunchSessionId(correction.employeeId, correction.workDate, correction.fieldChanged, executor);
  return {
    correctionId: correction.id,
    fieldChanged: correction.fieldChanged,
    eventId: null,
    correctedValue: correction.correctedValue,
    sessionId,
  };
}

async function recalculateDailyRecordInternal(
  ctx: RequestContext,
  employeeId: string,
  workDate: string,
  executor: DbExecutor = db,
): Promise<AttendanceDailyRecord> {
  const sessions = await buildSessionInputs(employeeId, workDate, executor);

  // Only APPROVED corrections may affect calculation — PENDING/REJECTED never reach this list
  // (see attendanceCorrectionRepository.listApprovedForWorkDate). This is the one authoritative
  // calculation path: both manual recalculation and approval-triggered recalculation go through
  // exactly this function, so they can never disagree.
  const approvedCorrections = await attendanceCorrectionRepository.listApprovedForWorkDate(employeeId, workDate, executor);
  const overrides = await Promise.all(approvedCorrections.map((correction) => buildCorrectionOverride(ctx, correction, executor)));
  const correctedSessions = applyCorrectionsToSessions(sessions, overrides);

  const dayInfo = await getWorkforceDayInfo(ctx, employeeId, workDate);
  const window = dayInfo.expectedWindow;

  const dayContext: DailyWorkforceContext = {
    isHoliday: dayInfo.isHoliday,
    isWeeklyOff: dayInfo.isWeeklyOff,
    isWorkingDay: dayInfo.isWorkingDay,
    expectedStartAt: window ? zonedWallTimeToUtc(window.start.date, window.start.time, dayInfo.timezone) : null,
    expectedEndAt: window ? zonedWallTimeToUtc(window.end.date, window.end.time, dayInfo.timezone) : null,
    gracePeriodMinutes: dayInfo.scheduleAssignment?.shift?.gracePeriodMinutes ?? 0,
  };

  const result = calculateDailyAttendance(correctedSessions, dayContext);

  return attendanceDailyRecordRepository.upsert(executor, {
    companyId: ctx.companyId,
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

/** Explicit, permission-gated recalculation (e.g. after a correction is approved, or an HR-
 *  triggered "recompute this day" action). Internally, check-out already triggers this
 *  automatically for immediate feedback — this is the externally callable form. */
export async function recalculateDailyRecord(ctx: RequestContext, requestedEmployeeId: string, workDate: string): Promise<AttendanceDailyRecord> {
  requirePermission(ctx, "attendance.recalculate");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  await loadEmployeeInCompany(ctx, targetEmployeeId);

  // Batch 8 — a closed period cannot be recalculated (§15). Wrapped in its own transaction purely
  // to hold the period's SHARE lock for the duration of the write that follows; `recalculateDailyRecordInternal`
  // otherwise has no transactional needs of its own (a single upsert statement is already atomic).
  const record = await db.transaction(async (tx) => {
    await assertAttendancePeriodOpen(ctx.companyId, workDate, tx);
    return recalculateDailyRecordInternal(ctx, targetEmployeeId, workDate, tx);
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

/** Returns the day's calculated record (computing it on demand if it doesn't exist yet — daily
 *  records are derived/recalculable, not a separate source of truth, so this is safe — see
 *  ADR-0003) plus that date's sessions, each enriched with its own display-only duration (see
 *  `AttendanceSessionView`) — never the source of the day's authoritative totals.
 *
 *  Batch 8 — this is a GET path, so the "compute on demand" behavior above must never INSERT/
 *  UPDATE `attendance_daily_records` for a work date whose period is CLOSED (a closed period must
 *  stay frozen even for reads that happen to be the first thing to look at a given day). When no
 *  record exists yet AND the period is closed, this returns the synthetic, non-persisted
 *  `"UNPROCESSED"` stand-in (see `UnprocessedAttendanceDayRecord`) instead of calling
 *  `recalculateDailyRecordInternal` — the same "no row = not yet known, never fabricated" idea the
 *  calendar already uses, just applied to a single-day read instead of a grid. Deliberately uses
 *  the lightweight, non-locking `isAttendancePeriodClosed` (a plain read) rather than
 *  `assertAttendancePeriodOpen` — that guard exists to hold a SHARE lock across a *write*
 *  transaction, which this function has none of. An existing record is always returned exactly as
 *  stored, whether the period is open or closed — no lookup or check is needed for that branch. */
export async function getAttendanceDay(
  ctx: RequestContext,
  requestedEmployeeId: string,
  workDate: string,
): Promise<{ record: AttendanceDayRecord; sessions: AttendanceSessionView[] }> {
  requirePermission(ctx, "attendance.view");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  await loadEmployeeInCompany(ctx, targetEmployeeId);

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

  const record = await recalculateDailyRecordInternal(ctx, targetEmployeeId, workDate);
  return { record, sessions };
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
  const zoned = utcToZonedWallTime(input.correctedValue, timezone);
  if (zoned.date !== input.workDate && zoned.date !== addDays(input.workDate, 1)) {
    throw new InvalidCorrectionTargetError(
      "The corrected time, read in the employee's timezone, falls outside the work date being corrected (or the day immediately after it, for an overnight shift).",
    );
  }

  // Batch 8 — wrapped in a transaction (this function previously used no transaction at all) so
  // the period SHARE lock is held from the very first check through the final INSERT below, not
  // just for one isolated read (§24 race safety).
  const correction = await db.transaction(async (tx) => {
    await assertAttendancePeriodOpen(ctx.companyId, input.workDate, tx);

    let eventId: string | null = null;
    let originalValue: Date | null = null;

    if (input.eventId) {
      const event = await resolveCorrectionEventTarget(ctx, targetEmployeeId, input.workDate, input.fieldChanged, input.eventId, tx);
      eventId = event.id;
      originalValue = event.occurredAt;
    } else {
      // Confirms exactly one legitimate missing-punch target exists right now. The resolved
      // target itself isn't stored on the correction — `buildCorrectionOverride` re-resolves it
      // at approval time, since more attendance activity may have happened between request and review.
      await resolveMissingPunchSessionId(targetEmployeeId, input.workDate, input.fieldChanged, tx);
    }

    // §14: two corrections may never both end up APPROVED for the same logical (employeeId,
    // workDate, fieldChanged, eventId) target — reject a new request that would conflict with an
    // existing PENDING or APPROVED one rather than silently choosing one.
    const conflict = await attendanceCorrectionRepository.findConflicting(targetEmployeeId, input.workDate, input.fieldChanged, eventId, tx);
    if (conflict) throw new ConflictingCorrectionError();

    return attendanceCorrectionRepository.create(
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
  });

  await recordAuditLog(ctx, {
    action: "attendance.correction.create",
    entityType: "attendance_correction",
    entityId: correction.id,
    newData: correction,
    metadata: { employeeId: targetEmployeeId },
  });
  return correction;
}

export async function listCorrectionsForEmployee(ctx: RequestContext, requestedEmployeeId: string): Promise<AttendanceCorrectionWithDetails[]> {
  requirePermission(ctx, "attendance.view");
  const targetEmployeeId = resolveTargetEmployeeId(ctx, requestedEmployeeId);
  await loadEmployeeInCompany(ctx, targetEmployeeId);
  return attendanceCorrectionRepository.listForEmployee(targetEmployeeId);
}

export async function listCompanyCorrections(
  ctx: RequestContext,
  status?: "PENDING" | "APPROVED" | "REJECTED",
): Promise<AttendanceCorrectionWithDetails[]> {
  requirePermission(ctx, "attendance.correction.approve");
  return attendanceCorrectionRepository.listForCompany(ctx.companyId, status);
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
 * The same HR user who requested a correction may also approve/reject it — no second-approver
 * requirement is added (existing, deliberate scope).
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

    const reviewed = await attendanceCorrectionRepository.review(
      correctionId,
      { status, reviewedByUserId: ctx.userId, reviewNote: input.reviewNote ?? null },
      tx,
    );

    if (status === "APPROVED") {
      try {
        await recalculateDailyRecordInternal(ctx, existing.employeeId, existing.workDate, tx);
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
