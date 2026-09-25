import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../../tests/setup/db";

const available = await isDatabaseAvailable();

// Many sequential real-Postgres round trips per test (employee/schedule setup, check-in/out,
// corrections, period close, the investigation call itself) — same class of flakiness already
// documented in the other attendance integration test files.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

/**
 * Batch 9 — `getAttendanceInvestigation` is a pure read composition over already-authoritative
 * functions (`getAttendanceDay`, `getWorkforceDayInfo`, and two day-scoped repository listings).
 * These tests exist to prove the composition is correct and safe, not to re-verify calculation
 * rules already covered by `calculation.test.ts`/`service.test.ts`, or period-lock rules already
 * covered by `periods/__tests__/attendance-period.service.test.ts` — this file leans on those as
 * ground truth and checks that the investigation aggregate reflects them faithfully.
 */
describe.skipIf(!available)("attendance investigation service", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let investigationSvc: typeof import("../attendance-investigation.service");
  let attendanceSvc: typeof import("../../service");
  let periodSvc: typeof import("../../periods/attendance-period.service");
  let employeeService: typeof import("@/domains/employee/service");
  let workforceSvc: typeof import("@/domains/workforce/service");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;

  let companyAId: string;
  let companyBId: string;
  let branchId: string;
  let adminUserId: string;
  let ctx: import("@/lib/auth/request-context").RequestContext; // COMPANY_ADMIN, company A
  let ctxManager: import("@/lib/auth/request-context").RequestContext;
  let ctxHrManager: import("@/lib/auth/request-context").RequestContext;
  let ctxCompanyB: import("@/lib/auth/request-context").RequestContext;

  const ASSIGNMENT_START = "2020-01-01";
  let daySchedule: { id: string };
  let graceShift: { id: string };
  let nightShift: { id: string };
  let employeeCounter = 0;

  function ctxFor(overrides: Partial<import("@/lib/auth/request-context").RequestContext>) {
    return { ...ctx, requestId: `inv-test-${Date.now()}-${Math.random()}`, ...overrides };
  }

  async function newEmployee(overrides: { dateOfJoining?: string } = {}) {
    employeeCounter += 1;
    return employeeService.createEmployee(ctx, {
      firstName: "Inv",
      lastName: `Test-${Date.now()}-${employeeCounter}`,
      workEmail: `inv-test-${Date.now()}-${employeeCounter}@test.local`,
      dateOfJoining: overrides.dateOfJoining ?? "2020-01-01",
      locationId: branchId,
    });
  }

  async function makeEmployeeCtx(employeeId: string) {
    const [empUser] = await db
      .insert(schema.users)
      .values({ email: `inv-emp-user-${Date.now()}-${Math.random()}@test.local`, passwordHash: "unused", fullName: "Investigation Employee User" })
      .returning();
    return { ...ctx, requestId: `inv-test-emp-${Date.now()}`, role: "EMPLOYEE" as const, userId: empUser!.id, userEmail: empUser!.email, employeeId };
  }

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    investigationSvc = await import("../attendance-investigation.service");
    attendanceSvc = await import("../../service");
    periodSvc = await import("../../periods/attendance-period.service");
    employeeService = await import("@/domains/employee/service");
    workforceSvc = await import("@/domains/workforce/service");
    ({ AuthorizationError } = await import("@/lib/errors"));

    const [companyA] = await db.insert(schema.companies).values({ name: "Investigation Test Co A", code: `INV_TEST_A_${Date.now()}`, timezone: "UTC" }).returning();
    const [companyB] = await db.insert(schema.companies).values({ name: "Investigation Test Co B", code: `INV_TEST_B_${Date.now()}`, timezone: "UTC" }).returning();
    companyAId = companyA!.id;
    companyBId = companyB!.id;

    const [adminUser] = await db.insert(schema.users).values({ email: `inv-admin-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Investigation Test Admin" }).returning();
    adminUserId = adminUser!.id;

    ctx = { requestId: "inv-test", userId: adminUserId, userEmail: adminUser!.email, companyId: companyAId, role: "COMPANY_ADMIN", employeeId: null };
    ctxManager = ctxFor({ role: "MANAGER" });
    ctxHrManager = ctxFor({ role: "HR_MANAGER" });
    ctxCompanyB = ctxFor({ companyId: companyBId });

    const [branch] = await db.insert(schema.branches).values({ companyId: companyAId, name: "Inv HQ", code: `INV_HQ_${Date.now()}`, timezone: "UTC" }).returning();
    branchId = branch!.id;

    daySchedule = await workforceSvc.createWorkSchedule(ctx, { name: `InvDay-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
    graceShift = await workforceSvc.createShift(ctx, {
      name: `InvGrace-${Date.now()}`,
      code: `INV_GRACE_${Date.now()}`,
      startTime: "09:00:00",
      endTime: "18:00:00",
      gracePeriodMinutes: 0,
    });
    nightShift = await workforceSvc.createShift(ctx, {
      name: `InvNight-${Date.now()}`,
      code: `INV_NIGHT_${Date.now()}`,
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

  describe("daily statuses", () => {
    it("1. PRESENT", async () => {
      const WORK_DATE = "2033-08-01";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, shiftId: graceShift.id, effectiveFrom: ASSIGNMENT_START });

      vi.setSystemTime(new Date(`${WORK_DATE}T09:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date(`${WORK_DATE}T18:00:00Z`));
      await attendanceSvc.checkOut(ctx, employee.id);

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.record.status).toBe("PRESENT");
      expect(result.sessions).toHaveLength(1);
      expect(result.events.map((e) => e.eventType)).toEqual(["CHECK_IN", "CHECK_OUT"]);
      expect(result.corrections).toEqual([]);
      expect(result.periodClosed).toBe(false);
      expect(result.workforceExpectation.isWorkingDay).toBe(true);
    });

    it("2. LATE", async () => {
      const WORK_DATE = "2033-08-02";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, shiftId: graceShift.id, effectiveFrom: ASSIGNMENT_START });

      vi.setSystemTime(new Date(`${WORK_DATE}T09:30:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date(`${WORK_DATE}T18:00:00Z`));
      await attendanceSvc.checkOut(ctx, employee.id);

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.record.status).toBe("LATE");
      expect(result.record.lateMinutes).toBe(30);
    });

    it("3. ABSENT", async () => {
      const WORK_DATE = "2033-08-03";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.record.status).toBe("ABSENT");
      expect(result.sessions).toEqual([]);
      expect(result.events).toEqual([]);
    });

    it("4. INCOMPLETE", async () => {
      const WORK_DATE = "2033-08-04";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });

      vi.setSystemTime(new Date(`${WORK_DATE}T09:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.record.status).toBe("INCOMPLETE");
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]!.checkOutAt).toBeNull();
      expect(result.sessions[0]!.status).toBe("OPEN");

      // Leave no open session behind for later tests in this file.
      await attendanceSvc.checkOut(ctx, employee.id);
    });

    it("5. WEEKLY_OFF", async () => {
      const WORK_DATE = "2033-07-16"; // a Saturday
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });
      await workforceSvc.setCompanyDefaultWeeklyOff(ctx, { offDays: [6], effectiveFrom: ASSIGNMENT_START });

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.record.status).toBe("WEEKLY_OFF");
      expect(result.workforceExpectation.isWeeklyOff).toBe(true);
    });

    it("6. HOLIDAY", async () => {
      const WORK_DATE = "2033-08-06";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });
      await workforceSvc.createHoliday(ctx, { name: `Inv Holiday ${Date.now()}`, date: WORK_DATE, holidayType: "PUBLIC" });

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.record.status).toBe("HOLIDAY");
      expect(result.workforceExpectation.isHoliday).toBe(true);
    });

    it("7. WEEKLY_OFF_WORKED", async () => {
      const WORK_DATE = "2033-07-23"; // also a Saturday
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });
      await workforceSvc.setCompanyDefaultWeeklyOff(ctx, { offDays: [6], effectiveFrom: ASSIGNMENT_START });

      vi.setSystemTime(new Date(`${WORK_DATE}T10:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date(`${WORK_DATE}T14:00:00Z`));
      await attendanceSvc.checkOut(ctx, employee.id);

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.record.status).toBe("WEEKLY_OFF_WORKED");
    });

    it("8. HOLIDAY_WORKED", async () => {
      const WORK_DATE = "2033-08-08";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });
      await workforceSvc.createHoliday(ctx, { name: `Inv Holiday Worked ${Date.now()}`, date: WORK_DATE, holidayType: "PUBLIC" });

      vi.setSystemTime(new Date(`${WORK_DATE}T10:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date(`${WORK_DATE}T14:00:00Z`));
      await attendanceSvc.checkOut(ctx, employee.id);

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.record.status).toBe("HOLIDAY_WORKED");
    });

    it("9. NO_SCHEDULE", async () => {
      const WORK_DATE = "2033-08-09";
      const employee = await newEmployee(); // no schedule assignment at all

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.record.status).toBe("NO_SCHEDULE");
      expect(result.workforceExpectation.scheduleAssignment).toBeNull();
    });

    it("10. UNPROCESSED (closed period, no record)", async () => {
      const MONTH = "2033-09";
      const WORK_DATE = `${MONTH}-10`;
      const employee = await newEmployee();
      await periodSvc.closeAttendancePeriod(ctx, MONTH);

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.record.status).toBe("UNPROCESSED");
      expect(result.record.id).toBeNull();
      expect(result.record.calculatedAt).toBeNull();
      expect(result.periodClosed).toBe(true);
    });
  });

  describe("sessions, breaks, and events", () => {
    it("11. multiple sessions in one day", async () => {
      const WORK_DATE = "2033-08-11";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });

      vi.setSystemTime(new Date(`${WORK_DATE}T09:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date(`${WORK_DATE}T12:00:00Z`));
      await attendanceSvc.checkOut(ctx, employee.id);
      vi.setSystemTime(new Date(`${WORK_DATE}T13:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date(`${WORK_DATE}T18:00:00Z`));
      await attendanceSvc.checkOut(ctx, employee.id);

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.sessions).toHaveLength(2);
      expect(result.events).toHaveLength(4);
    });

    it("12. open session (no checkout)", async () => {
      const WORK_DATE = "2033-08-12";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });

      vi.setSystemTime(new Date(`${WORK_DATE}T09:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]!.status).toBe("OPEN");
      expect(result.sessions[0]!.sessionWorkedMinutes).toBeNull();

      await attendanceSvc.checkOut(ctx, employee.id);
    });

    it("13. abandoned session — an earlier forgotten check-in superseded by a later one", async () => {
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });

      const DAY1 = "2033-08-13";
      const DAY2 = "2033-08-14";
      vi.setSystemTime(new Date(`${DAY1}T09:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id); // never checked out
      vi.setSystemTime(new Date(`${DAY2}T09:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id); // supersedes day1's session -> ABANDONED

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, DAY1);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]!.status).toBe("ABANDONED");

      vi.setSystemTime(new Date(`${DAY2}T18:00:00Z`));
      await attendanceSvc.checkOut(ctx, employee.id);
    });

    it("14. breaks — a closed session's break interval is reported with start/end/duration", async () => {
      const WORK_DATE = "2033-08-15";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });

      vi.setSystemTime(new Date(`${WORK_DATE}T09:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date(`${WORK_DATE}T12:58:00Z`));
      await attendanceSvc.startBreak(ctx, employee.id);
      vi.setSystemTime(new Date(`${WORK_DATE}T13:30:00Z`));
      await attendanceSvc.endBreak(ctx, employee.id);
      vi.setSystemTime(new Date(`${WORK_DATE}T18:12:00Z`));
      await attendanceSvc.checkOut(ctx, employee.id);

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.sessions).toHaveLength(1);
      const breaks = result.sessions[0]!.breaks;
      expect(breaks).toHaveLength(1);
      expect(breaks[0]!.startAt.toISOString()).toBe(`${WORK_DATE}T12:58:00.000Z`);
      expect(breaks[0]!.endAt?.toISOString()).toBe(`${WORK_DATE}T13:30:00.000Z`);
      expect(result.sessions[0]!.sessionBreakMinutes).toBe(32);
      expect(result.events.map((e) => e.eventType)).toEqual(["CHECK_IN", "BREAK_START", "BREAK_END", "CHECK_OUT"]);
    });

    it("15. overnight/cross-midnight session — keyed by the shift-start day", async () => {
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, shiftId: nightShift.id, effectiveFrom: ASSIGNMENT_START });

      const START_DATE = "2033-08-16";
      vi.setSystemTime(new Date(`${START_DATE}T22:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date("2033-08-17T06:00:00Z"));
      await attendanceSvc.checkOut(ctx, employee.id);

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, START_DATE);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]!.workDate).toBe(START_DATE);
      expect(result.sessions[0]!.checkOutAt?.toISOString()).toBe("2033-08-17T06:00:00.000Z");
      expect(result.record.status).not.toBe("UNPROCESSED");
    });

    it("16. schedule change between two sessions on the same day", async () => {
      const WORK_DATE = "2033-08-18";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });

      vi.setSystemTime(new Date(`${WORK_DATE}T09:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date(`${WORK_DATE}T12:00:00Z`));
      await attendanceSvc.checkOut(ctx, employee.id);

      // Re-assign to a shift, effective from the same day, before the second check-in.
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, shiftId: graceShift.id, effectiveFrom: WORK_DATE });

      vi.setSystemTime(new Date(`${WORK_DATE}T13:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date(`${WORK_DATE}T18:00:00Z`));
      await attendanceSvc.checkOut(ctx, employee.id);

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.sessions).toHaveLength(2);
      // Each session keeps its own captured-at-check-in snapshot, independently.
      expect(result.sessions[0]!.expectedShiftId).toBeNull();
      expect(result.sessions[1]!.expectedShiftId).toBe(graceShift.id);
    });
  });

  describe("corrections", () => {
    it("17. approved correction is shown and its effect is reflected in the record", async () => {
      const WORK_DATE = "2033-08-20";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });

      vi.setSystemTime(new Date(`${WORK_DATE}T09:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);
      await attendanceSvc.recalculateDailyRecord(ctx, employee.id, WORK_DATE); // materialize INCOMPLETE first

      const correction = await attendanceSvc.requestCorrection(ctx, employee.id, {
        workDate: WORK_DATE,
        fieldChanged: "CHECK_OUT",
        correctedValue: new Date(`${WORK_DATE}T18:00:00Z`),
        reason: "Forgot to check out",
      });
      await attendanceSvc.approveCorrection(ctx, correction.id);

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.corrections).toHaveLength(1);
      expect(result.corrections[0]!.status).toBe("APPROVED");
      expect(result.corrections[0]!.reviewedBy?.id).toBe(adminUserId);
      expect(result.record.status).not.toBe("INCOMPLETE");
    });

    it("18. pending correction is shown, unreviewed", async () => {
      const WORK_DATE = "2033-08-21";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });

      vi.setSystemTime(new Date(`${WORK_DATE}T09:30:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date(`${WORK_DATE}T18:00:00Z`));
      await attendanceSvc.checkOut(ctx, employee.id);

      const checkInEvent = await db.query.attendanceEvents.findFirst({
        where: (t, { and, eq: dbEq }) => and(dbEq(t.employeeId, employee.id), dbEq(t.eventType, "CHECK_IN")),
      });
      await attendanceSvc.requestCorrection(ctx, employee.id, {
        workDate: WORK_DATE,
        eventId: checkInEvent!.id,
        fieldChanged: "CHECK_IN",
        correctedValue: new Date(`${WORK_DATE}T09:00:00Z`),
        reason: "Clock was off by 30 minutes",
      });

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.corrections).toHaveLength(1);
      expect(result.corrections[0]!.status).toBe("PENDING");
      expect(result.corrections[0]!.reviewedBy).toBeNull();
    });

    it("19. rejected correction is shown, marked rejected", async () => {
      const WORK_DATE = "2033-08-22";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });

      vi.setSystemTime(new Date(`${WORK_DATE}T09:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date(`${WORK_DATE}T18:00:00Z`));
      await attendanceSvc.checkOut(ctx, employee.id);

      const checkOutEvent = await db.query.attendanceEvents.findFirst({
        where: (t, { and, eq: dbEq }) => and(dbEq(t.employeeId, employee.id), dbEq(t.eventType, "CHECK_OUT")),
      });
      const correction = await attendanceSvc.requestCorrection(ctx, employee.id, {
        workDate: WORK_DATE,
        eventId: checkOutEvent!.id,
        fieldChanged: "CHECK_OUT",
        correctedValue: new Date(`${WORK_DATE}T19:00:00Z`),
        reason: "Claimed extra hour",
      });
      await attendanceSvc.rejectCorrection(ctx, correction.id, { reviewNote: "No evidence" });

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.corrections).toHaveLength(1);
      expect(result.corrections[0]!.status).toBe("REJECTED");
      expect(result.corrections[0]!.reviewNote).toBe("No evidence");
    });
  });

  describe("closed period", () => {
    it("20. closed period + existing record — returned unchanged, no write", async () => {
      const MONTH = "2033-10";
      const WORK_DATE = `${MONTH}-05`;
      const employee = await newEmployee();
      const oldCalculatedAt = new Date("2020-05-05T00:00:00Z");
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

      const before = await db.select({ id: schema.attendanceDailyRecords.id }).from(schema.attendanceDailyRecords).where(eq(schema.attendanceDailyRecords.companyId, companyAId));
      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      const after = await db.select({ id: schema.attendanceDailyRecords.id }).from(schema.attendanceDailyRecords).where(eq(schema.attendanceDailyRecords.companyId, companyAId));

      expect(result.record.status).toBe("ABSENT");
      expect(result.record.calculatedAt).toEqual(oldCalculatedAt);
      expect(after.length).toBe(before.length);
    });

    it("21. closed period + no record — UNPROCESSED, zero writes across every attendance table", async () => {
      const MONTH = "2033-11";
      const WORK_DATE = `${MONTH}-06`;
      const employee = await newEmployee();
      await periodSvc.closeAttendancePeriod(ctx, MONTH);

      async function counts() {
        const [dailyRecords, events, openSessions, corrections] = await Promise.all([
          db.select({ id: schema.attendanceDailyRecords.id }).from(schema.attendanceDailyRecords).where(eq(schema.attendanceDailyRecords.companyId, companyAId)).then((r) => r.length),
          db.select({ id: schema.attendanceEvents.id }).from(schema.attendanceEvents).where(eq(schema.attendanceEvents.companyId, companyAId)).then((r) => r.length),
          db.select({ id: schema.attendanceOpenSessions.id }).from(schema.attendanceOpenSessions).where(eq(schema.attendanceOpenSessions.companyId, companyAId)).then((r) => r.length),
          db.select({ id: schema.attendanceCorrections.id }).from(schema.attendanceCorrections).where(eq(schema.attendanceCorrections.companyId, companyAId)).then((r) => r.length),
        ]);
        return { dailyRecords, events, openSessions, corrections };
      }

      const before = await counts();
      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      const after = await counts();

      expect(result.record.status).toBe("UNPROCESSED");
      expect(result.record.id).toBeNull();
      expect(result.sessions).toEqual([]);
      expect(result.events).toEqual([]);
      expect(result.corrections).toEqual([]);
      expect(after).toEqual(before);
    });
  });

  describe("edge dates and employee states", () => {
    it("22. future date — succeeds, reflects existing (unchanged) lazy-materialization behavior", async () => {
      const WORK_DATE = "2099-01-15";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });

      await expect(investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE)).resolves.toBeDefined();
    });

    it("23. archived employee — investigation remains readable", async () => {
      const WORK_DATE = "2033-08-25";
      const employee = await newEmployee();
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });
      await db.update(schema.employees).set({ isArchived: true }).where(eq(schema.employees.id, employee.id));

      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, WORK_DATE);
      expect(result.record.status).toBe("ABSENT");
    });

    it("24. not-yet-joined employee — investigation still succeeds for a date before joining", async () => {
      const employee = await newEmployee({ dateOfJoining: "2040-01-01" });
      const result = await investigationSvc.getAttendanceInvestigation(ctx, employee.id, "2033-08-26");
      expect(result).toBeDefined();
    });
  });

  describe("25. tenant isolation", () => {
    it("a user from another company cannot investigate company A's employee, and nothing leaks", async () => {
      const WORK_DATE = "2033-08-27";
      const employee = await newEmployee();

      await expect(investigationSvc.getAttendanceInvestigation(ctxCompanyB, employee.id, WORK_DATE)).rejects.toThrow(AuthorizationError);
    });
  });

  describe("26. RBAC and self-scope", () => {
    it("MANAGER and HR_MANAGER (existing attendance.view/employee.view holders) can investigate", async () => {
      const WORK_DATE = "2033-08-28";
      const employee = await newEmployee();
      await expect(investigationSvc.getAttendanceInvestigation(ctxManager, employee.id, WORK_DATE)).resolves.toBeDefined();
      await expect(investigationSvc.getAttendanceInvestigation(ctxHrManager, employee.id, WORK_DATE)).resolves.toBeDefined();
    });

    it("an EMPLOYEE caller always resolves to their own record, never a requested other employee's", async () => {
      const WORK_DATE = "2033-08-29";
      const self = await newEmployee();
      const other = await newEmployee();
      const ctxSelf = await makeEmployeeCtx(self.id);

      const result = await investigationSvc.getAttendanceInvestigation(ctxSelf, other.id, WORK_DATE);
      expect(result.record.employeeId).toBe(self.id);

      const leaked = await db.query.attendanceDailyRecords.findFirst({
        where: (t, { and, eq: dbEq }) => and(dbEq(t.employeeId, other.id), dbEq(t.workDate, WORK_DATE)),
      });
      expect(leaked).toBeUndefined();
    });
  });
});
