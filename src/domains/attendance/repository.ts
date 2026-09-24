import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or } from "drizzle-orm";
import { db, type DbExecutor, type Transaction } from "@/db/client";
import { attendanceCorrections, attendanceDailyRecords, attendanceEvents, attendanceOpenSessions, branches, departments, employees } from "@/db/schema";
import type { AttendanceDailyStatus, AttendanceEventType, AttendanceSource } from "./model";

export type CreateSessionInput = {
  companyId: string;
  employeeId: string;
  workDate: string;
  checkInAt: Date;
  expectedWorkScheduleId: string | null;
  expectedShiftId: string | null;
  expectedStartAt: Date | null;
  expectedEndAt: Date | null;
  resolvedTimezone: string | null;
  gracePeriodMinutes: number;
  isHoliday: boolean;
  isWeeklyOff: boolean;
  isWorkingDay: boolean;
  source: AttendanceSource;
};

export const attendanceSessionRepository = {
  findById(id: string, executor: DbExecutor = db) {
    return executor.query.attendanceOpenSessions.findFirst({ where: eq(attendanceOpenSessions.id, id) });
  },
  /** At most one row can ever match — enforced by a partial unique index. Read-only use (e.g.
   *  `getCurrentSession`) — no row lock, since nothing is mutated afterward. Includes the
   *  captured-at-check-in schedule/shift's own rows (via the relations already defined in
   *  schema/relations.ts) purely for display — the snapshot's own `expectedStartAt`/`expectedEndAt`/
   *  etc. remain the only fields calculation.ts ever reads. */
  findOpenForEmployee(employeeId: string, executor: DbExecutor = db) {
    return executor.query.attendanceOpenSessions.findFirst({
      where: and(eq(attendanceOpenSessions.employeeId, employeeId), eq(attendanceOpenSessions.status, "OPEN")),
      with: { expectedWorkSchedule: true, expectedShift: true },
    });
  },
  /** Same query as `findOpenForEmployee`, but takes a `SELECT ... FOR UPDATE` row lock — every
   *  operation that mutates a session or appends an event to it (checkIn's abandon check, checkOut,
   *  startBreak, endBreak) must read through this, not `findOpenForEmployee`, so two concurrent
   *  requests for the same employee are serialized: the second waits for the first's transaction
   *  to commit, then re-reads the post-commit state instead of acting on a stale snapshot. Without
   *  this, two concurrent CHECK_OUT calls could both see the session as OPEN and both succeed,
   *  producing a duplicate CHECK_OUT event and a checkOutAt race. Must only be called inside a
   *  transaction — the lock is released as soon as that transaction ends. */
  async findOpenForEmployeeLocked(employeeId: string, tx: Transaction) {
    const rows = await tx
      .select()
      .from(attendanceOpenSessions)
      .where(and(eq(attendanceOpenSessions.employeeId, employeeId), eq(attendanceOpenSessions.status, "OPEN")))
      .for("update");
    return rows[0] ?? null;
  },
  /** The employee's most recent session regardless of status — the "prior session" input to the
   *  workDate inheritance rule (open, closed, or abandoned all count; see service.ts). */
  findMostRecentForEmployee(employeeId: string, executor: DbExecutor = db) {
    return executor.query.attendanceOpenSessions.findFirst({
      where: eq(attendanceOpenSessions.employeeId, employeeId),
      orderBy: desc(attendanceOpenSessions.checkInAt),
    });
  },
  /** Includes the schedule/shift names for display, same rationale as `findOpenForEmployee`. */
  listForEmployeeWorkDate(employeeId: string, workDate: string, executor: DbExecutor = db) {
    return executor.query.attendanceOpenSessions.findMany({
      where: and(eq(attendanceOpenSessions.employeeId, employeeId), eq(attendanceOpenSessions.workDate, workDate)),
      orderBy: asc(attendanceOpenSessions.checkInAt),
      with: { expectedWorkSchedule: true, expectedShift: true },
    });
  },
  create(tx: DbExecutor, input: CreateSessionInput) {
    return tx
      .insert(attendanceOpenSessions)
      .values({ ...input, status: "OPEN" })
      .returning()
      .then((rows) => rows[0]!);
  },
  markAbandoned(tx: DbExecutor, id: string) {
    return tx
      .update(attendanceOpenSessions)
      .set({ status: "ABANDONED" })
      .where(eq(attendanceOpenSessions.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
  markClosed(tx: DbExecutor, id: string, checkOutAt: Date) {
    return tx
      .update(attendanceOpenSessions)
      .set({ status: "CLOSED", checkOutAt })
      .where(eq(attendanceOpenSessions.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
};

export type CreateEventInput = {
  companyId: string;
  employeeId: string;
  sessionId: string;
  workDate: string;
  eventType: AttendanceEventType;
  occurredAt: Date;
  source: AttendanceSource;
  sourceMetadata: Record<string, unknown> | null;
  idempotencyKey: string | null;
};

export const attendanceEventRepository = {
  create(tx: DbExecutor, input: CreateEventInput) {
    return tx
      .insert(attendanceEvents)
      .values(input)
      .returning()
      .then((rows) => rows[0]!);
  },
  /** Used to validate a correction's `eventId` at request time (must exist, belong to the
   *  employee/company/work date being corrected). */
  findById(id: string, executor: DbExecutor = db) {
    return executor.query.attendanceEvents.findFirst({ where: eq(attendanceEvents.id, id) });
  },
  findByIdempotencyKey(employeeId: string, idempotencyKey: string, executor: DbExecutor = db) {
    return executor.query.attendanceEvents.findFirst({
      where: and(eq(attendanceEvents.employeeId, employeeId), eq(attendanceEvents.idempotencyKey, idempotencyKey)),
    });
  },
  listForSession(sessionId: string, executor: DbExecutor = db) {
    return executor.query.attendanceEvents.findMany({
      where: eq(attendanceEvents.sessionId, sessionId),
      orderBy: asc(attendanceEvents.occurredAt),
    });
  },
  /** The most recent BREAK_START in this session with no matching BREAK_END yet, if any. Breaks
   *  are derived from the event stream rather than tracked in a separate table — there are at most
   *  a handful of break events per session, so scanning them per check-out/break-end is cheap and
   *  avoids a second piece of mutable state to keep in sync with the immutable event log. */
  async findOpenBreak(sessionId: string, executor: DbExecutor = db) {
    const events = await executor.query.attendanceEvents.findMany({
      where: and(eq(attendanceEvents.sessionId, sessionId)),
      orderBy: asc(attendanceEvents.occurredAt),
    });
    let open: (typeof events)[number] | null = null;
    for (const event of events) {
      if (event.eventType === "BREAK_START") open = event;
      else if (event.eventType === "BREAK_END") open = null;
    }
    return open;
  },
  /** Every break interval for a session, derived from the event stream — closed pairs plus a
   *  trailing open one (endAt: null) if the last BREAK_START has no matching BREAK_END yet. */
  async listBreaksForSession(sessionId: string, executor: DbExecutor = db) {
    const events = await executor.query.attendanceEvents.findMany({
      where: eq(attendanceEvents.sessionId, sessionId),
      orderBy: asc(attendanceEvents.occurredAt),
    });
    // startEventId/endEventId let a BREAK_START/BREAK_END correction (Batch 4) identify exactly
    // which break within the session it targets — calculateDailyAttendance itself never reads them.
    const breaks: { startAt: Date; endAt: Date | null; startEventId: string | null; endEventId: string | null }[] = [];
    let open: { startAt: Date; startEventId: string } | null = null;
    for (const event of events) {
      if (event.eventType === "BREAK_START") open = { startAt: event.occurredAt, startEventId: event.id };
      else if (event.eventType === "BREAK_END" && open) {
        breaks.push({ startAt: open.startAt, endAt: event.occurredAt, startEventId: open.startEventId, endEventId: event.id });
        open = null;
      }
    }
    if (open) breaks.push({ startAt: open.startAt, endAt: null, startEventId: open.startEventId, endEventId: null });
    return breaks;
  },
  listForEmployeeWorkDate(employeeId: string, workDate: string, executor: DbExecutor = db) {
    return executor.query.attendanceEvents.findMany({
      where: and(eq(attendanceEvents.employeeId, employeeId), eq(attendanceEvents.workDate, workDate)),
      orderBy: asc(attendanceEvents.occurredAt),
    });
  },
  /** BREAK_START/BREAK_END events for several sessions in one query — used by the dashboard's
   *  "Currently Working" section to determine each open session's break state in bulk, instead of
   *  one `findOpenBreak` call per row (which would be N+1 for a company with many people checked
   *  in at once). */
  listBreakEventsForSessions(sessionIds: string[], executor: DbExecutor = db) {
    if (sessionIds.length === 0) return Promise.resolve([]);
    return executor.query.attendanceEvents.findMany({
      where: and(inArray(attendanceEvents.sessionId, sessionIds), inArray(attendanceEvents.eventType, ["BREAK_START", "BREAK_END"])),
      orderBy: asc(attendanceEvents.occurredAt),
    });
  },
};

export const attendanceDailyRecordRepository = {
  findOne(employeeId: string, workDate: string, executor: DbExecutor = db) {
    return executor.query.attendanceDailyRecords.findFirst({
      where: and(eq(attendanceDailyRecords.employeeId, employeeId), eq(attendanceDailyRecords.workDate, workDate)),
    });
  },
  listForEmployeeRange(employeeId: string, from: string, to: string, executor: DbExecutor = db) {
    return executor.query.attendanceDailyRecords.findMany({
      where: and(eq(attendanceDailyRecords.employeeId, employeeId), gte(attendanceDailyRecords.workDate, from), lte(attendanceDailyRecords.workDate, to)),
      orderBy: asc(attendanceDailyRecords.workDate),
    });
  },
  async upsert(
    executor: DbExecutor,
    input: {
      companyId: string;
      employeeId: string;
      workDate: string;
      status: (typeof attendanceDailyRecords.$inferInsert)["status"];
      scheduledMinutes: number;
      workedMinutes: number | null;
      breakMinutes: number;
      overtimeMinutes: number | null;
      lateMinutes: number | null;
      earlyDepartureMinutes: number | null;
      firstCheckInAt: Date | null;
      lastCheckOutAt: Date | null;
      sessionCount: number;
    },
  ) {
    const rows = await executor
      .insert(attendanceDailyRecords)
      .values({ ...input, calculatedAt: new Date() })
      .onConflictDoUpdate({
        target: [attendanceDailyRecords.employeeId, attendanceDailyRecords.workDate],
        set: {
          status: input.status,
          scheduledMinutes: input.scheduledMinutes,
          workedMinutes: input.workedMinutes,
          breakMinutes: input.breakMinutes,
          overtimeMinutes: input.overtimeMinutes,
          lateMinutes: input.lateMinutes,
          earlyDepartureMinutes: input.earlyDepartureMinutes,
          firstCheckInAt: input.firstCheckInAt,
          lastCheckOutAt: input.lastCheckOutAt,
          sessionCount: input.sessionCount,
          calculatedAt: new Date(),
        },
      })
      .returning();
    return rows[0]!;
  },
};

const CORRECTION_DETAIL_RELATIONS = {
  employee: { columns: { id: true, firstName: true, lastName: true, employeeNumber: true } },
  requestedBy: { columns: { id: true, fullName: true } },
  reviewedBy: { columns: { id: true, fullName: true } },
} as const;

export const attendanceCorrectionRepository = {
  findById(id: string, executor: DbExecutor = db) {
    return executor.query.attendanceCorrections.findFirst({ where: eq(attendanceCorrections.id, id) });
  },
  findByIdWithDetails(id: string, executor: DbExecutor = db) {
    return executor.query.attendanceCorrections.findFirst({
      where: eq(attendanceCorrections.id, id),
      with: CORRECTION_DETAIL_RELATIONS,
    });
  },
  /** `SELECT ... FOR UPDATE` — must only be called inside a transaction. Locks the correction row
   *  so a concurrent approve/reject attempt on the same correction blocks until this transaction
   *  commits or rolls back, then re-reads the post-commit status (same pattern as
   *  `attendanceSessionRepository.findOpenForEmployeeLocked`). This is what makes
   *  PENDING -> APPROVED/REJECTED a genuine once-only transition under concurrency. */
  async findByIdLocked(id: string, tx: Transaction) {
    const rows = await tx.select().from(attendanceCorrections).where(eq(attendanceCorrections.id, id)).for("update");
    return rows[0] ?? null;
  },
  listForEmployee(employeeId: string, executor: DbExecutor = db) {
    return executor.query.attendanceCorrections.findMany({
      where: eq(attendanceCorrections.employeeId, employeeId),
      orderBy: desc(attendanceCorrections.createdAt),
      with: CORRECTION_DETAIL_RELATIONS,
    });
  },
  listForCompany(companyId: string, status: "PENDING" | "APPROVED" | "REJECTED" | undefined, executor: DbExecutor = db) {
    return executor.query.attendanceCorrections.findMany({
      where: status
        ? and(eq(attendanceCorrections.companyId, companyId), eq(attendanceCorrections.status, status))
        : eq(attendanceCorrections.companyId, companyId),
      orderBy: desc(attendanceCorrections.createdAt),
      with: CORRECTION_DETAIL_RELATIONS,
    });
  },
  /** Any PENDING or APPROVED correction already targeting this exact logical field for this
   *  employee/work date — the deterministic conflict check (§14): two corrections may never both
   *  end up APPROVED for the same (employeeId, workDate, fieldChanged, eventId) tuple. `eventId`
   *  null is matched against null (two missing-punch corrections for the same field/date conflict
   *  with each other too). */
  findConflicting(
    employeeId: string,
    workDate: string,
    fieldChanged: (typeof attendanceCorrections.$inferSelect)["fieldChanged"],
    eventId: string | null,
    executor: DbExecutor = db,
  ) {
    return executor.query.attendanceCorrections.findFirst({
      where: and(
        eq(attendanceCorrections.employeeId, employeeId),
        eq(attendanceCorrections.workDate, workDate),
        eq(attendanceCorrections.fieldChanged, fieldChanged),
        eventId ? eq(attendanceCorrections.eventId, eventId) : isNull(attendanceCorrections.eventId),
        inArray(attendanceCorrections.status, ["PENDING", "APPROVED"]),
      ),
    });
  },
  /** Approved corrections for one (employeeId, workDate) — the calculation engine's override
   *  input (see service.ts `recalculateDailyRecordInternal`). */
  listApprovedForWorkDate(employeeId: string, workDate: string, executor: DbExecutor = db) {
    return executor.query.attendanceCorrections.findMany({
      where: and(
        eq(attendanceCorrections.employeeId, employeeId),
        eq(attendanceCorrections.workDate, workDate),
        eq(attendanceCorrections.status, "APPROVED"),
      ),
    });
  },
  create(
    input: {
      companyId: string;
      employeeId: string;
      workDate: string;
      eventId: string | null;
      fieldChanged: (typeof attendanceCorrections.$inferSelect)["fieldChanged"];
      originalValue: Date | null;
      correctedValue: Date;
      requestedByUserId: string;
      reason: string;
    },
    executor: DbExecutor = db,
  ) {
    return executor
      .insert(attendanceCorrections)
      .values(input)
      .returning()
      .then((rows) => rows[0]!);
  },
  review(
    id: string,
    input: { status: "APPROVED" | "REJECTED"; reviewedByUserId: string; reviewNote: string | null },
    executor: DbExecutor = db,
  ) {
    return executor
      .update(attendanceCorrections)
      .set({ status: input.status, reviewedByUserId: input.reviewedByUserId, reviewedAt: new Date(), reviewNote: input.reviewNote })
      .where(eq(attendanceCorrections.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
};

// ---------------------------------------------------------------------------
// HR/Manager dashboard (Batch 3) — read-only queries over the existing tables. No new table, no
// recalculation: every figure comes from attendance_daily_records / attendance_open_sessions as
// they already stand. Bounded by design: the paginated table only ever touches the current page's
// rows; the late/incomplete/currently-working lists are bounded by how many records/sessions
// actually match that day, not by total company size.
// ---------------------------------------------------------------------------

export type DashboardEmployeeFilters = { search?: string; departmentId?: string; locationId?: string };

function buildActiveEmployeeConditions(companyId: string, filters: DashboardEmployeeFilters) {
  const conditions = [eq(employees.companyId, companyId), eq(employees.isArchived, false), eq(employees.employmentStatus, "ACTIVE")];
  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(or(ilike(employees.firstName, term), ilike(employees.lastName, term), ilike(employees.employeeNumber, term))!);
  }
  if (filters.departmentId) conditions.push(eq(employees.departmentId, filters.departmentId));
  if (filters.locationId) conditions.push(eq(employees.locationId, filters.locationId));
  return and(...conditions)!;
}

export const attendanceDashboardRepository = {
  countActiveEmployees(companyId: string, executor: DbExecutor = db): Promise<number> {
    return executor
      .select({ value: count() })
      .from(employees)
      .where(and(eq(employees.companyId, companyId), eq(employees.isArchived, false), eq(employees.employmentStatus, "ACTIVE")))
      .then((rows) => rows[0]?.value ?? 0);
  },
  /** One row per status that has at least one record for this date — callers fill in zero for
   *  every status with no row, rather than this query inventing zero-rows for all nine. */
  getStatusCounts(companyId: string, workDate: string, executor: DbExecutor = db): Promise<{ status: AttendanceDailyStatus; value: number }[]> {
    // Joined to `employees` and scoped to active ones so a record left over from a
    // since-archived/terminated employee never inflates a status count or skews the derived
    // "no record yet" figure against the active headcount.
    return executor
      .select({ status: attendanceDailyRecords.status, value: count() })
      .from(attendanceDailyRecords)
      .innerJoin(employees, eq(attendanceDailyRecords.employeeId, employees.id))
      .where(
        and(
          eq(attendanceDailyRecords.companyId, companyId),
          eq(attendanceDailyRecords.workDate, workDate),
          eq(employees.isArchived, false),
          eq(employees.employmentStatus, "ACTIVE"),
        ),
      )
      .groupBy(attendanceDailyRecords.status);
  },
  /** The paginated table's rows: every active employee matching the filters, LEFT JOINed to
   *  whatever daily record exists for `workDate` (null fields when none does — see
   *  `AttendanceDashboardRow`). This is the one place a raw join (not the relational query API) is
   *  needed, since the joined table's own condition depends on a runtime date parameter. */
  async listTableRows(
    companyId: string,
    workDate: string,
    filters: DashboardEmployeeFilters & { status?: AttendanceDailyStatus; page: number; pageSize: number },
    executor: DbExecutor = db,
  ) {
    const conditions = [buildActiveEmployeeConditions(companyId, filters)];
    if (filters.status) conditions.push(eq(attendanceDailyRecords.status, filters.status));

    return executor
      .select({ employee: employees, department: departments, location: branches, record: attendanceDailyRecords })
      .from(employees)
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(branches, eq(employees.locationId, branches.id))
      .leftJoin(attendanceDailyRecords, and(eq(attendanceDailyRecords.employeeId, employees.id), eq(attendanceDailyRecords.workDate, workDate)))
      .where(and(...conditions))
      .orderBy(asc(employees.firstName), asc(employees.lastName))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);
  },
  async countTableRows(
    companyId: string,
    workDate: string,
    filters: DashboardEmployeeFilters & { status?: AttendanceDailyStatus },
    executor: DbExecutor = db,
  ): Promise<number> {
    const conditions = [buildActiveEmployeeConditions(companyId, filters)];
    if (filters.status) conditions.push(eq(attendanceDailyRecords.status, filters.status));

    const rows = await executor
      .select({ value: count() })
      .from(employees)
      .leftJoin(attendanceDailyRecords, and(eq(attendanceDailyRecords.employeeId, employees.id), eq(attendanceDailyRecords.workDate, workDate)))
      .where(and(...conditions));
    return rows[0]?.value ?? 0;
  },
  /** Daily records for a company+date narrowed to one status — bounded by how many employees
   *  actually have that status that day (typically small), not by company size. */
  listRecordsByStatus(companyId: string, workDate: string, status: AttendanceDailyStatus, executor: DbExecutor = db) {
    return executor.query.attendanceDailyRecords.findMany({
      where: and(eq(attendanceDailyRecords.companyId, companyId), eq(attendanceDailyRecords.workDate, workDate), eq(attendanceDailyRecords.status, status)),
    });
  },
  /** Every session for a company+date, with the schedule/shift it captured — used to (a) resolve
   *  the table/late/incomplete rows' "Schedule"/"Shift" display columns via each employee's first
   *  session that day, and (b) as the base data for late-arrival lookups. Bounded by how many
   *  people actually checked in that day. */
  listSessionsForWorkDate(companyId: string, workDate: string, executor: DbExecutor = db) {
    return executor.query.attendanceOpenSessions.findMany({
      where: and(eq(attendanceOpenSessions.companyId, companyId), eq(attendanceOpenSessions.workDate, workDate)),
      orderBy: asc(attendanceOpenSessions.checkInAt),
      with: { expectedWorkSchedule: true, expectedShift: true },
    });
  },
  /** All currently OPEN sessions company-wide, regardless of workDate (an overnight shift's open
   *  session may carry yesterday's workDate but is still "currently working" right now) — bounded
   *  by how many people are actually checked in at this instant. */
  listCurrentlyWorking(companyId: string, executor: DbExecutor = db) {
    return executor.query.attendanceOpenSessions.findMany({
      where: and(eq(attendanceOpenSessions.companyId, companyId), eq(attendanceOpenSessions.status, "OPEN")),
      orderBy: asc(attendanceOpenSessions.checkInAt),
      with: { expectedWorkSchedule: true, expectedShift: true },
    });
  },
  /** Employees by id, with department/location, for enriching a small bounded set of
   *  records/sessions (late list, incomplete list, currently-working list) — never called with an
   *  unbounded id list. */
  listByIds(companyId: string, employeeIds: string[], executor: DbExecutor = db) {
    if (employeeIds.length === 0) return Promise.resolve([]);
    return executor.query.employees.findMany({
      where: and(eq(employees.companyId, companyId), inArray(employees.id, employeeIds)),
      with: { department: { columns: { id: true, name: true } }, location: { columns: { id: true, name: true } } },
    });
  },
};
