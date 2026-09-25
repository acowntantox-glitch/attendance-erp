import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";

const available = await isDatabaseAvailable();

// Several sequential real-Postgres round trips per test (employee/schedule setup, period close,
// getAttendanceDay, direct row checks) — same class of flakiness already documented in the other
// attendance integration test files.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

/**
 * Batch 8 follow-up — regression coverage for the audit finding that `getAttendanceDay` (a GET/
 * read path) was lazily INSERTing a new `attendance_daily_records` row for a work date with no
 * existing record, with no period-lock check at all. The fix: when no record exists AND the
 * period is CLOSED, return the synthetic, non-persisted `"UNPROCESSED"` stand-in instead of
 * calling `recalculateDailyRecordInternal`. See `getAttendanceDay` in `../service.ts` and
 * `UnprocessedAttendanceDayRecord` in `../model.ts`.
 */
describe.skipIf(!available)("getAttendanceDay — closed-period read-only guarantee", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let attendanceSvc: typeof import("../service");
  let periodSvc: typeof import("../periods/attendance-period.service");
  let calendarSvc: typeof import("../calendar/attendance-calendar.service");
  let reportSvc: typeof import("../reports/attendance-report.service");
  let employeeService: typeof import("@/domains/employee/service");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;

  let companyAId: string;
  let companyBId: string;
  let adminUserId: string;
  let ctx: import("@/lib/auth/request-context").RequestContext; // COMPANY_ADMIN, company A
  let ctxCompanyB: import("@/lib/auth/request-context").RequestContext;

  let employeeCounter = 0;

  async function newEmployee(companyCtx = ctx) {
    employeeCounter += 1;
    return employeeService.createEmployee(companyCtx, {
      firstName: "GetDay",
      lastName: `Test-${Date.now()}-${employeeCounter}`,
      workEmail: `get-day-test-${Date.now()}-${employeeCounter}@test.local`,
      dateOfJoining: "2020-01-01",
    });
  }

  async function makeEmployeeCtx(employeeId: string) {
    const [empUser] = await db
      .insert(schema.users)
      .values({ email: `get-day-emp-user-${Date.now()}-${Math.random()}@test.local`, passwordHash: "unused", fullName: "Get Day Employee User" })
      .returning();
    return { ...ctx, requestId: `get-day-emp-${Date.now()}`, role: "EMPLOYEE" as const, userId: empUser!.id, userEmail: empUser!.email, employeeId };
  }

  async function dailyRecordCount(companyId: string) {
    const rows = await db.select({ id: schema.attendanceDailyRecords.id }).from(schema.attendanceDailyRecords).where(eq(schema.attendanceDailyRecords.companyId, companyId));
    return rows.length;
  }

  async function fullCounts(companyId: string) {
    const [dailyRecords, events, openSessions, corrections] = await Promise.all([
      dailyRecordCount(companyId),
      db.select({ id: schema.attendanceEvents.id }).from(schema.attendanceEvents).where(eq(schema.attendanceEvents.companyId, companyId)).then((r) => r.length),
      db.select({ id: schema.attendanceOpenSessions.id }).from(schema.attendanceOpenSessions).where(eq(schema.attendanceOpenSessions.companyId, companyId)).then((r) => r.length),
      db.select({ id: schema.attendanceCorrections.id }).from(schema.attendanceCorrections).where(eq(schema.attendanceCorrections.companyId, companyId)).then((r) => r.length),
    ]);
    return { dailyRecords, events, openSessions, corrections };
  }

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    attendanceSvc = await import("../service");
    periodSvc = await import("../periods/attendance-period.service");
    calendarSvc = await import("../calendar/attendance-calendar.service");
    reportSvc = await import("../reports/attendance-report.service");
    employeeService = await import("@/domains/employee/service");
    ({ AuthorizationError } = await import("@/lib/errors"));

    const [companyA] = await db.insert(schema.companies).values({ name: "GetDay Test Co A", code: `GETDAY_TEST_A_${Date.now()}`, timezone: "UTC" }).returning();
    const [companyB] = await db.insert(schema.companies).values({ name: "GetDay Test Co B", code: `GETDAY_TEST_B_${Date.now()}`, timezone: "UTC" }).returning();
    companyAId = companyA!.id;
    companyBId = companyB!.id;

    const [adminUser] = await db.insert(schema.users).values({ email: `get-day-admin-${Date.now()}@test.local`, passwordHash: "unused", fullName: "GetDay Test Admin" }).returning();
    adminUserId = adminUser!.id;

    ctx = { requestId: "get-day-test", userId: adminUserId, userEmail: adminUser!.email, companyId: companyAId, role: "COMPANY_ADMIN", employeeId: null };
    ctxCompanyB = { ...ctx, companyId: companyBId, requestId: "get-day-test-b" };
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

  describe("A. OPEN period + no daily record", () => {
    it("still lazily materializes exactly one daily record", async () => {
      const MONTH = "2033-01";
      const WORK_DATE = `${MONTH}-10`;
      const employee = await newEmployee();

      const before = await dailyRecordCount(companyAId);
      const noneYet = await db.query.attendanceDailyRecords.findFirst({
        where: (t, { and, eq: dbEq }) => and(dbEq(t.employeeId, employee.id), dbEq(t.workDate, WORK_DATE)),
      });
      expect(noneYet).toBeUndefined();

      const result = await attendanceSvc.getAttendanceDay(ctx, employee.id, WORK_DATE);
      expect(result.record.status).not.toBe("UNPROCESSED");
      expect(result.record.id).not.toBeNull();

      const after = await dailyRecordCount(companyAId);
      expect(after - before).toBe(1);

      const persisted = await db.query.attendanceDailyRecords.findFirst({
        where: (t, { and, eq: dbEq }) => and(dbEq(t.employeeId, employee.id), dbEq(t.workDate, WORK_DATE)),
      });
      expect(persisted).toBeDefined();
      expect(persisted?.status).toBe(result.record.status);
    });
  });

  describe("B. CLOSED period + no daily record", () => {
    it("succeeds, creates no daily record, and represents the day as UNPROCESSED", async () => {
      const MONTH = "2033-02";
      const WORK_DATE = `${MONTH}-10`;
      const employee = await newEmployee();
      await periodSvc.closeAttendancePeriod(ctx, MONTH);

      const before = await fullCounts(companyAId);

      const result = await attendanceSvc.getAttendanceDay(ctx, employee.id, WORK_DATE);

      expect(result.record.status).toBe("UNPROCESSED");
      expect(result.record.id).toBeNull();
      expect(result.record.calculatedAt).toBeNull();
      expect(result.record.workDate).toBe(WORK_DATE);
      expect(result.record.employeeId).toBe(employee.id);

      const after = await fullCounts(companyAId);
      expect(after.dailyRecords).toBe(before.dailyRecords); // the core assertion — no INSERT happened
      expect(after.events).toBe(before.events);
      expect(after.openSessions).toBe(before.openSessions);
      expect(after.corrections).toBe(before.corrections);

      const persisted = await db.query.attendanceDailyRecords.findFirst({
        where: (t, { and, eq: dbEq }) => and(dbEq(t.employeeId, employee.id), dbEq(t.workDate, WORK_DATE)),
      });
      expect(persisted).toBeUndefined();
    });
  });

  describe("C. CLOSED period + existing daily record", () => {
    it("returns the existing record unchanged, with no write at all", async () => {
      const MONTH = "2033-03";
      const WORK_DATE = `${MONTH}-11`;
      const employee = await newEmployee();

      const oldCalculatedAt = new Date("2020-06-15T00:00:00Z");
      await db.insert(schema.attendanceDailyRecords).values({
        companyId: companyAId,
        employeeId: employee.id,
        workDate: WORK_DATE,
        status: "ABSENT",
        scheduledMinutes: 480,
        workedMinutes: 0,
        breakMinutes: 0,
        sessionCount: 0,
        calculatedAt: oldCalculatedAt,
      });

      await periodSvc.closeAttendancePeriod(ctx, MONTH);

      const before = await fullCounts(companyAId);
      const result = await attendanceSvc.getAttendanceDay(ctx, employee.id, WORK_DATE);

      expect(result.record.status).toBe("ABSENT");
      expect(result.record.calculatedAt).toEqual(oldCalculatedAt);

      const after = await fullCounts(companyAId);
      expect(after.dailyRecords).toBe(before.dailyRecords);
      expect(after.events).toBe(before.events);
      expect(after.openSessions).toBe(before.openSessions);
      expect(after.corrections).toBe(before.corrections);

      const persisted = await db.query.attendanceDailyRecords.findFirst({
        where: (t, { and, eq: dbEq }) => and(dbEq(t.employeeId, employee.id), dbEq(t.workDate, WORK_DATE)),
      });
      expect(persisted?.calculatedAt).toEqual(oldCalculatedAt);
      expect(persisted?.status).toBe("ABSENT");
    });
  });

  describe("D. CLOSED period + other GET endpoints remain read-only", () => {
    it("getCurrentSession, dashboard, calendar, and reports never write for a closed period", async () => {
      const MONTH = "2033-04";
      const WORK_DATE = `${MONTH}-12`;
      const employee = await newEmployee();
      await periodSvc.closeAttendancePeriod(ctx, MONTH);

      const before = await fullCounts(companyAId);

      await expect(attendanceSvc.getCurrentSession(ctx, employee.id)).resolves.toBeDefined();
      await expect(
        attendanceSvc.getAttendanceDashboard(ctx, { workDate: WORK_DATE, page: 1, pageSize: 25 }),
      ).resolves.toBeDefined();
      await expect(calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 25 })).resolves.toBeDefined();
      await expect(
        reportSvc.getAttendanceReport(ctx, { fromDate: `${MONTH}-01`, toDate: `${MONTH}-28` }, { page: 1, pageSize: 25 }),
      ).resolves.toBeDefined();

      const after = await fullCounts(companyAId);
      expect(after).toEqual(before);
    });
  });

  describe("E. Tenant isolation", () => {
    it("a user from another company cannot reach this path against company A's employee, and no record leaks into existence", async () => {
      const MONTH = "2033-05";
      const WORK_DATE = `${MONTH}-13`;
      const employee = await newEmployee(); // company A

      await expect(attendanceSvc.getAttendanceDay(ctxCompanyB, employee.id, WORK_DATE)).rejects.toThrow(AuthorizationError);

      const persisted = await db.query.attendanceDailyRecords.findFirst({
        where: (t, { and, eq: dbEq }) => and(dbEq(t.employeeId, employee.id), dbEq(t.workDate, WORK_DATE)),
      });
      expect(persisted).toBeUndefined();
    });
  });

  describe("F. Employee self-scope / RBAC", () => {
    it("an EMPLOYEE caller always resolves to their own record, never a requested other employee's, and can still read a closed period", async () => {
      const MONTH = "2033-06";
      const WORK_DATE = `${MONTH}-14`;
      const selfEmployee = await newEmployee();
      const otherEmployee = await newEmployee();
      const ctxSelf = await makeEmployeeCtx(selfEmployee.id);

      await periodSvc.closeAttendancePeriod(ctx, MONTH);

      // Passing otherEmployee.id as the requested id — must silently resolve to self, per
      // resolveTargetEmployeeId's existing EMPLOYEE self-scope rule, unchanged by this fix.
      const result = await attendanceSvc.getAttendanceDay(ctxSelf, otherEmployee.id, WORK_DATE);
      expect(result.record.employeeId).toBe(selfEmployee.id);
      expect(result.record.status).toBe("UNPROCESSED");

      const otherRecord = await db.query.attendanceDailyRecords.findFirst({
        where: (t, { and, eq: dbEq }) => and(dbEq(t.employeeId, otherEmployee.id), dbEq(t.workDate, WORK_DATE)),
      });
      expect(otherRecord).toBeUndefined();
    });
  });
});
