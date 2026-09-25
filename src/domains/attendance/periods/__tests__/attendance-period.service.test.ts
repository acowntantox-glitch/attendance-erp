import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../../tests/setup/db";
import { monthSchema } from "@/validations/attendance";
import { firstDayOfMonth, lastDayOfMonth } from "../../calendar/attendance-calendar.service";

const available = await isDatabaseAvailable();

// Many tests below do several sequential real-Postgres round trips (schedule/employee setup,
// check-in/out, close/reopen, corrections, dashboard/calendar reads) — same class of flakiness
// already documented in the other attendance integration test files.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

// Pure, DB-independent — a period's date range is exactly the month it names, reused as-is from
// Batch 7's calendar module (§31). Deliberately checking the exact 2026-09-30/2026-10-01 boundary:
// this range is what `countOpenInRange`/`getMonthStatusCounts` use to decide which sessions/records
// belong to a period being closed, so an off-by-one here would silently include or exclude a day.
describe("period month date boundaries (firstDayOfMonth / lastDayOfMonth)", () => {
  it("resolves a 30-day month's range exactly, with no bleed into the next month", () => {
    expect(firstDayOfMonth("2026-09")).toBe("2026-09-01");
    expect(lastDayOfMonth("2026-09")).toBe("2026-09-30");
    expect(lastDayOfMonth("2026-09")).not.toBe("2026-10-01");
  });

  it("resolves a 31-day month and a December-to-January year rollover", () => {
    expect(lastDayOfMonth("2026-10")).toBe("2026-10-31");
    expect(firstDayOfMonth("2026-12")).toBe("2026-12-01");
    expect(lastDayOfMonth("2026-12")).toBe("2026-12-31");
  });

  it("resolves February in a leap year vs. a non-leap year", () => {
    expect(lastDayOfMonth("2028-02")).toBe("2028-02-29"); // 2028 is a leap year
    expect(lastDayOfMonth("2026-02")).toBe("2026-02-28"); // 2026 is not
  });
});

// Batch 8 reuses this schema (renamed export, no new one) to validate the `[month]` route param —
// same YYYY-MM shape Batch 7 already established for the calendar route.
describe("monthSchema (YYYY-MM) parsing, as reused for the [month] period routes", () => {
  it("accepts a valid YYYY-MM month", () => {
    expect(monthSchema.safeParse("2026-09").success).toBe(true);
    expect(monthSchema.safeParse("2026-01").success).toBe(true);
    expect(monthSchema.safeParse("2026-12").success).toBe(true);
  });

  it.each(["2026-13", "2026-00", "2026-9", "2026", "09-2026", "2026/09", ""])("rejects an invalid month format (%s)", (month) => {
    expect(monthSchema.safeParse(month).success).toBe(false);
  });
});

describe.skipIf(!available)("attendance period service (Batch 8)", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let periodSvc: typeof import("../attendance-period.service");
  let attendanceSvc: typeof import("../../service");
  let processingSvc: typeof import("../../processing/attendance-processing.service");
  let calendarSvc: typeof import("../../calendar/attendance-calendar.service");
  let periodErrors: typeof import("../../errors");
  let employeeService: typeof import("@/domains/employee/service");
  let workforceSvc: typeof import("@/domains/workforce/service");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;

  let companyAId: string;
  let companyBId: string;
  let adminUserId: string;
  let ctx: import("@/lib/auth/request-context").RequestContext; // COMPANY_ADMIN — lock + unlock
  let ctxHrAdmin: import("@/lib/auth/request-context").RequestContext; // lock only
  let ctxHrManager: import("@/lib/auth/request-context").RequestContext; // neither
  let ctxManager: import("@/lib/auth/request-context").RequestContext; // neither
  let ctxEmployee: import("@/lib/auth/request-context").RequestContext; // neither
  let ctxCompanyB: import("@/lib/auth/request-context").RequestContext;

  const ASSIGNMENT_START = "2020-01-01";
  let daySchedule: { id: string };
  let nightShift: { id: string };
  let employeeCounter = 0;

  function ctxFor(overrides: Partial<import("@/lib/auth/request-context").RequestContext>) {
    return { ...ctx, requestId: `period-test-${Date.now()}-${Math.random()}`, ...overrides };
  }

  async function newEmployee(companyCtx = ctx, withNightShift = false) {
    employeeCounter += 1;
    const employee = await employeeService.createEmployee(companyCtx, {
      firstName: "Period",
      lastName: `Test-${Date.now()}-${employeeCounter}`,
      workEmail: `period-test-${Date.now()}-${employeeCounter}@test.local`,
      dateOfJoining: "2020-01-01",
    });
    await workforceSvc.assignEmployeeSchedule(companyCtx, employee.id, {
      workScheduleId: daySchedule.id,
      shiftId: withNightShift ? nightShift.id : undefined,
      effectiveFrom: ASSIGNMENT_START,
    });
    return employee;
  }

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    periodSvc = await import("../attendance-period.service");
    attendanceSvc = await import("../../service");
    processingSvc = await import("../../processing/attendance-processing.service");
    calendarSvc = await import("../../calendar/attendance-calendar.service");
    periodErrors = await import("../../errors");
    employeeService = await import("@/domains/employee/service");
    workforceSvc = await import("@/domains/workforce/service");
    ({ AuthorizationError } = await import("@/lib/errors"));

    const [companyA] = await db
      .insert(schema.companies)
      .values({ name: "Period Test Co A", code: `PERIOD_TEST_A_${Date.now()}`, timezone: "UTC" })
      .returning();
    const [companyB] = await db
      .insert(schema.companies)
      .values({ name: "Period Test Co B", code: `PERIOD_TEST_B_${Date.now()}`, timezone: "UTC" })
      .returning();
    companyAId = companyA!.id;
    companyBId = companyB!.id;

    const [adminUser] = await db
      .insert(schema.users)
      .values({ email: `period-admin-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Period Test Admin" })
      .returning();
    adminUserId = adminUser!.id;

    ctx = { requestId: "period-test", userId: adminUserId, userEmail: adminUser!.email, companyId: companyAId, role: "COMPANY_ADMIN", employeeId: null };
    ctxHrAdmin = ctxFor({ role: "HR_ADMIN" });
    ctxHrManager = ctxFor({ role: "HR_MANAGER" });
    ctxManager = ctxFor({ role: "MANAGER" });
    ctxEmployee = ctxFor({ role: "EMPLOYEE" });
    ctxCompanyB = ctxFor({ companyId: companyBId });

    daySchedule = await workforceSvc.createWorkSchedule(ctx, { name: `PeriodDay-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
    nightShift = await workforceSvc.createShift(ctx, {
      name: `PeriodNight-${Date.now()}`,
      code: `PERIOD_NIGHT_${Date.now()}`,
      startTime: "22:00:00",
      endTime: "06:00:00",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await db.delete(schema.companies).where(eq(schema.companies.id, companyAId));
    await db.delete(schema.companies).where(eq(schema.companies.id, companyBId));
    await db.delete(schema.users).where(eq(schema.users.id, adminUserId));
    await pool.end();
  });

  describe("listAttendancePeriods / getAttendancePeriod", () => {
    it("synthesizes a virtual OPEN entry for a month never touched — absence of a row means OPEN, not a fabricated status", async () => {
      const view = await periodSvc.getAttendancePeriod(ctx, "2031-01");
      expect(view).toEqual({ periodMonth: "2031-01", status: "OPEN", closedAt: null, closedByName: null });

      const rows = await db.query.attendancePeriods.findFirst({
        where: (t, { and: dbAnd, eq: dbEq }) => dbAnd(dbEq(t.companyId, companyAId), dbEq(t.periodMonth, "2031-01")),
      });
      expect(rows).toBeUndefined();
    });

    it("viewing periods requires attendance.period.lock or .unlock; MANAGER/EMPLOYEE are rejected", async () => {
      await expect(periodSvc.getAttendancePeriod(ctx, "2031-01")).resolves.toBeDefined();
      await expect(periodSvc.getAttendancePeriod(ctxHrAdmin, "2031-01")).resolves.toBeDefined();
      await expect(periodSvc.getAttendancePeriod(ctxManager, "2031-01")).rejects.toThrow(AuthorizationError);
      await expect(periodSvc.getAttendancePeriod(ctxEmployee, "2031-01")).rejects.toThrow(AuthorizationError);
    });

    it("listAttendancePeriods returns the current month plus monthsBack, newest first isn't required but every requested month is present exactly once", async () => {
      const periods = await periodSvc.listAttendancePeriods(ctx, 3);
      expect(periods).toHaveLength(4);
      const months = periods.map((p) => p.periodMonth);
      expect(new Set(months).size).toBe(4);
      for (const p of periods) {
        expect(p.status).toBe("OPEN");
      }
    });
  });

  describe("close / reopen lifecycle", () => {
    const MONTH = "2031-02";

    it("closes an open (virtual) period, recording closedAt/closedByUserId", async () => {
      const closed = await periodSvc.closeAttendancePeriod(ctx, MONTH);
      expect(closed.status).toBe("CLOSED");
      expect(closed.closedAt).toBeInstanceOf(Date);
      expect(closed.closedByName).toBeNull(); // toView's own-close short-circuit — see service.ts

      const persisted = await db.query.attendancePeriods.findFirst({
        where: (t, { and: dbAnd, eq: dbEq }) => dbAnd(dbEq(t.companyId, companyAId), dbEq(t.periodMonth, MONTH)),
      });
      expect(persisted?.status).toBe("CLOSED");
      expect(persisted?.closedByUserId).toBe(adminUserId);
    });

    it("rejects closing an already-closed period", async () => {
      await expect(periodSvc.closeAttendancePeriod(ctx, MONTH)).rejects.toThrow(periodErrors.AttendancePeriodAlreadyClosedError);
    });

    it("rejects reopening an already-open period", async () => {
      await expect(periodSvc.reopenAttendancePeriod(ctx, "2031-03")).rejects.toThrow(periodErrors.AttendancePeriodAlreadyOpenError);
    });

    it("reopens a closed period, clearing closedAt/closedByUserId", async () => {
      const reopened = await periodSvc.reopenAttendancePeriod(ctx, MONTH);
      expect(reopened.status).toBe("OPEN");
      expect(reopened.closedAt).toBeNull();

      const persisted = await db.query.attendancePeriods.findFirst({
        where: (t, { and: dbAnd, eq: dbEq }) => dbAnd(dbEq(t.companyId, companyAId), dbEq(t.periodMonth, MONTH)),
      });
      expect(persisted?.status).toBe("OPEN");
      expect(persisted?.closedByUserId).toBeNull();
    });
  });

  describe("open sessions block closing (never a fabricated checkout, never auto-abandon)", () => {
    it("rejects closing while an open session exists in the period, then succeeds once it's legitimately resolved", async () => {
      const MONTH = "2031-04";
      const workDate = `${MONTH}-15T09:00:00Z`;
      const employee = await newEmployee();

      vi.setSystemTime(new Date(workDate));
      await attendanceSvc.checkIn(ctx, employee.id);

      const preview = await periodSvc.previewAttendancePeriodClose(ctx, MONTH);
      expect(preview.openSessionCount).toBe(1);

      await expect(periodSvc.closeAttendancePeriod(ctx, MONTH)).rejects.toThrow(periodErrors.AttendancePeriodHasOpenSessionsError);

      // Still OPEN — a rejected close must never have partially applied.
      const stillOpen = await periodSvc.getAttendancePeriod(ctx, MONTH);
      expect(stillOpen.status).toBe("OPEN");

      vi.setSystemTime(new Date(`${MONTH}-15T18:00:00Z`));
      await attendanceSvc.checkOut(ctx, employee.id);

      const closed = await periodSvc.closeAttendancePeriod(ctx, MONTH);
      expect(closed.status).toBe("CLOSED");
    });
  });

  describe("mutation enforcement for a closed period", () => {
    const MONTH = "2031-05";
    const WORK_DATE = `${MONTH}-10`;

    beforeAll(async () => {
      await periodSvc.closeAttendancePeriod(ctx, MONTH);
    });

    it("rejects check-in for a work date whose month is closed", async () => {
      const employee = await newEmployee();

      vi.setSystemTime(new Date(`${WORK_DATE}T09:00:00Z`));
      await expect(attendanceSvc.checkIn(ctx, employee.id)).rejects.toThrow(periodErrors.AttendancePeriodLockedError);

      const openSessions = await db.query.attendanceOpenSessions.findFirst({ where: eq(schema.attendanceOpenSessions.employeeId, employee.id) });
      expect(openSessions).toBeUndefined(); // the rejected check-in must never have written anything
    });

    it("rejects check-out/start-break/end-break for an open session sitting inside a closed period", async () => {
      // An open session cannot normally come to exist inside an already-CLOSED period through the
      // application itself — closing a period is blocked by any open session within it (see the
      // "open sessions block closing" suite above), which is exactly what makes this combination
      // unreachable via the API. This is deliberately a direct-fixture test: it inserts the open
      // session row directly, bypassing checkIn, to prove checkOut/startBreak/endBreak carry their
      // own independent period-closed guard (§4 "enforced at the domain/service layer") rather than
      // relying solely on "an open session could never exist here anyway."
      const employee = await newEmployee();
      const [session] = await db
        .insert(schema.attendanceOpenSessions)
        .values({ companyId: companyAId, employeeId: employee.id, workDate: WORK_DATE, checkInAt: new Date(`${WORK_DATE}T09:00:00Z`) })
        .returning();
      expect(session).toBeDefined();

      await expect(attendanceSvc.checkOut(ctx, employee.id)).rejects.toThrow(periodErrors.AttendancePeriodLockedError);
      await expect(attendanceSvc.startBreak(ctx, employee.id)).rejects.toThrow(periodErrors.AttendancePeriodLockedError);
      await expect(attendanceSvc.endBreak(ctx, employee.id)).rejects.toThrow(periodErrors.AttendancePeriodLockedError);

      const persisted = await db.query.attendanceOpenSessions.findFirst({ where: eq(schema.attendanceOpenSessions.id, session!.id) });
      expect(persisted?.status).toBe("OPEN"); // untouched by every rejected attempt
    });

    it("rejects recalculateDailyRecord for a closed period", async () => {
      const employee = await newEmployee();
      await expect(attendanceSvc.recalculateDailyRecord(ctx, employee.id, WORK_DATE)).rejects.toThrow(periodErrors.AttendancePeriodLockedError);
    });

    it("rejects requestCorrection for a closed period", async () => {
      const employee = await newEmployee();
      await expect(
        attendanceSvc.requestCorrection(ctx, employee.id, {
          workDate: WORK_DATE,
          fieldChanged: "CHECK_IN",
          correctedValue: new Date(`${WORK_DATE}T09:05:00Z`),
          reason: "Testing closed-period rejection",
        }),
      ).rejects.toThrow(periodErrors.AttendancePeriodLockedError);
    });

    it("rejects approving/rejecting a still-PENDING correction once its period is closed after the request was made", async () => {
      const openMonth = "2031-06";
      const openWorkDate = `${openMonth}-10`;
      const employee = await newEmployee();

      const correction = await attendanceSvc.requestCorrection(ctx, employee.id, {
        workDate: openWorkDate,
        fieldChanged: "CHECK_IN",
        correctedValue: new Date(`${openWorkDate}T09:05:00Z`),
        reason: "Requested while the period was still open",
      });

      await periodSvc.closeAttendancePeriod(ctx, openMonth);

      await expect(attendanceSvc.approveCorrection(ctx, correction.id)).rejects.toThrow(periodErrors.AttendancePeriodLockedError);
      await expect(attendanceSvc.rejectCorrection(ctx, correction.id)).rejects.toThrow(periodErrors.AttendancePeriodLockedError);

      const persisted = await db.query.attendanceCorrections.findFirst({ where: eq(schema.attendanceCorrections.id, correction.id) });
      expect(persisted?.status).toBe("PENDING"); // neither rejected attempt applied
    });

    it("rejects processCompanyAttendanceDay (and transitively processEmployeeAttendanceDay) for a closed period", async () => {
      await expect(processingSvc.processCompanyAttendanceDay(ctx, { workDate: WORK_DATE })).rejects.toThrow(periodErrors.AttendancePeriodLockedError);

      const employee = await newEmployee();
      await expect(processingSvc.processEmployeeAttendanceDay(ctx, { employeeId: employee.id, workDate: WORK_DATE })).rejects.toThrow(
        periodErrors.AttendancePeriodLockedError,
      );
    });
  });

  describe("cross-midnight work-date binding", () => {
    it("an overnight session's period lock follows the session's own workDate (shift-start day), not the checkout's later calendar date", async () => {
      const septEmployee = await newEmployee(ctx, true);

      // Check in 2031-09-30 22:00 UTC (overnight shift) — session.workDate resolves to "2031-09-30".
      vi.setSystemTime(new Date("2031-09-30T22:00:00Z"));
      await attendanceSvc.checkIn(ctx, septEmployee.id);

      // Close OCTOBER up front — this must have no bearing on the still-open September session.
      await periodSvc.closeAttendancePeriod(ctx, "2031-10");

      // The checkout physically happens on the October calendar date, but the session's workDate
      // is September, and September is still OPEN — so this must succeed, not be rejected for
      // October being closed.
      vi.setSystemTime(new Date("2031-10-01T06:00:00Z"));
      const closedSession = await attendanceSvc.checkOut(ctx, septEmployee.id);
      expect(closedSession.workDate).toBe("2031-09-30");

      // September itself, meanwhile, still correctly blocks closing until now, and closes cleanly
      // once the (September-dated) session is resolved.
      const closedSeptember = await periodSvc.closeAttendancePeriod(ctx, "2031-09");
      expect(closedSeptember.status).toBe("CLOSED");
    });
  });

  describe("tenant isolation", () => {
    it("period status is scoped per company; closing company A's period never touches company B's, and company B cannot read or close company A's period by month alone", async () => {
      const MONTH = "2031-11";
      await periodSvc.closeAttendancePeriod(ctx, MONTH);

      const companyBView = await periodSvc.getAttendancePeriod(ctxCompanyB, MONTH);
      expect(companyBView.status).toBe("OPEN"); // company B's own (virtual) period for the same month string, unaffected

      const companyBClosed = await periodSvc.closeAttendancePeriod(ctxCompanyB, MONTH);
      expect(companyBClosed.status).toBe("CLOSED");

      const companyAStillClosed = await periodSvc.getAttendancePeriod(ctx, MONTH);
      expect(companyAStillClosed.status).toBe("CLOSED"); // unaffected by company B's own close

      const companyARow = await db.query.attendancePeriods.findFirst({
        where: (t, { and: dbAnd, eq: dbEq }) => dbAnd(dbEq(t.companyId, companyAId), dbEq(t.periodMonth, MONTH)),
      });
      const companyBRow = await db.query.attendancePeriods.findFirst({
        where: (t, { and: dbAnd, eq: dbEq }) => dbAnd(dbEq(t.companyId, companyBId), dbEq(t.periodMonth, MONTH)),
      });
      expect(companyARow?.id).not.toBe(companyBRow?.id);
    });
  });

  describe("RBAC", () => {
    it("HR_ADMIN can close but not reopen; COMPANY_ADMIN can do both; HR_MANAGER/MANAGER/EMPLOYEE can do neither", async () => {
      const closeOnlyMonth = "2031-12";
      const closed = await periodSvc.closeAttendancePeriod(ctxHrAdmin, closeOnlyMonth);
      expect(closed.status).toBe("CLOSED");
      await expect(periodSvc.reopenAttendancePeriod(ctxHrAdmin, closeOnlyMonth)).rejects.toThrow(AuthorizationError);

      await expect(periodSvc.closeAttendancePeriod(ctxHrManager, "2032-01")).rejects.toThrow(AuthorizationError);
      await expect(periodSvc.closeAttendancePeriod(ctxManager, "2032-01")).rejects.toThrow(AuthorizationError);
      await expect(periodSvc.closeAttendancePeriod(ctxEmployee, "2032-01")).rejects.toThrow(AuthorizationError);

      const reopened = await periodSvc.reopenAttendancePeriod(ctx, closeOnlyMonth);
      expect(reopened.status).toBe("OPEN");
    });
  });

  describe("audit logging", () => {
    it("records an audit log entry for close and for reopen", async () => {
      const MONTH = "2032-02";
      const closed = await periodSvc.closeAttendancePeriod(ctx, MONTH);
      const reopened = await periodSvc.reopenAttendancePeriod(ctx, MONTH);

      const closeLogs = await db.query.auditLogs.findMany({
        where: (t, { and: dbAnd, eq: dbEq }) => dbAnd(dbEq(t.action, "attendance.period.close"), dbEq(t.companyId, companyAId)),
      });
      expect(closeLogs.some((l) => l.metadata && (l.metadata as { periodMonth?: string }).periodMonth === MONTH)).toBe(true);

      const reopenLogs = await db.query.auditLogs.findMany({
        where: (t, { and: dbAnd, eq: dbEq }) => dbAnd(dbEq(t.action, "attendance.period.reopen"), dbEq(t.companyId, companyAId)),
      });
      expect(reopenLogs.some((l) => l.metadata && (l.metadata as { periodMonth?: string }).periodMonth === MONTH)).toBe(true);
      expect(closed.status).toBe("CLOSED");
      expect(reopened.status).toBe("OPEN");
    });
  });

  describe("reads remain fully available on a closed period", () => {
    it("getAttendanceDay and getAttendanceCalendar keep working for a closed month", async () => {
      const MONTH = "2032-03";
      const WORK_DATE = `${MONTH}-05`;
      const employee = await newEmployee();
      await periodSvc.closeAttendancePeriod(ctx, MONTH);

      await expect(attendanceSvc.getAttendanceDay(ctx, employee.id, WORK_DATE)).resolves.toBeDefined();
      await expect(calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 25 })).resolves.toBeDefined();
      await expect(attendanceSvc.getAttendanceDashboard(ctx, { workDate: WORK_DATE, page: 1, pageSize: 25 })).resolves.toBeDefined();
    });
  });
});
