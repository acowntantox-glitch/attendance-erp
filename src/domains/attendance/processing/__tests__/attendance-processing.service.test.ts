import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../../tests/setup/db";

const available = await isDatabaseAvailable();

vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

describe.skipIf(!available)("attendance processing service", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let svc: typeof import("../../service");
  let proc: typeof import("../attendance-processing.service");
  let errors: typeof import("../../errors");
  let workforceSvc: typeof import("@/domains/workforce/service");
  let employeeService: typeof import("@/domains/employee/service");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;

  let companyAId: string;
  let companyBId: string;
  let branchId: string;
  let adminUserId: string;
  let ctx: import("@/lib/auth/request-context").RequestContext;
  let ctxCompanyB: import("@/lib/auth/request-context").RequestContext;

  const ASSIGNMENT_START = "2020-01-01";

  let employeeScheduledId: string; // 09:00-18:00 schedule, no shift, grace = 0
  let employeeNoScheduleId: string; // no assignment at all

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    svc = await import("../../service");
    proc = await import("../attendance-processing.service");
    errors = await import("../../errors");
    workforceSvc = await import("@/domains/workforce/service");
    employeeService = await import("@/domains/employee/service");
    ({ AuthorizationError } = await import("@/lib/errors"));

    const [companyA] = await db
      .insert(schema.companies)
      .values({ name: "Processing Test Co A", code: `PROC_TEST_A_${Date.now()}`, timezone: "UTC" })
      .returning();
    const [companyB] = await db
      .insert(schema.companies)
      .values({ name: "Processing Test Co B", code: `PROC_TEST_B_${Date.now()}`, timezone: "UTC" })
      .returning();
    companyAId = companyA!.id;
    companyBId = companyB!.id;

    const [branch] = await db
      .insert(schema.branches)
      .values({ companyId: companyAId, name: "HQ", code: "PROC_TEST_HQ", timezone: "UTC" })
      .returning();
    branchId = branch!.id;

    const [adminUser] = await db
      .insert(schema.users)
      .values({ email: `proc-admin-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Processing Test Admin" })
      .returning();
    adminUserId = adminUser!.id;

    ctx = {
      requestId: "proc-test",
      userId: adminUserId,
      userEmail: adminUser!.email,
      companyId: companyAId,
      role: "COMPANY_ADMIN",
      employeeId: null,
    };
    ctxCompanyB = { ...ctx, companyId: companyBId, requestId: "proc-test-b" };

    const daySchedule = await workforceSvc.createWorkSchedule(ctx, {
      name: `ProcDay-${Date.now()}`,
      startTime: "09:00:00",
      endTime: "18:00:00",
    });

    const employeeScheduled = await employeeService.createEmployee(ctx, {
      firstName: "Proc",
      lastName: `Scheduled-${Date.now()}`,
      workEmail: `proc-scheduled-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branchId,
    });
    employeeScheduledId = employeeScheduled.id;
    await workforceSvc.assignEmployeeSchedule(ctx, employeeScheduledId, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });

    const employeeNoSchedule = await employeeService.createEmployee(ctx, {
      firstName: "Proc",
      lastName: `NoSchedule-${Date.now()}`,
      workEmail: `proc-noschedule-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branchId,
    });
    employeeNoScheduleId = employeeNoSchedule.id;
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

  async function countDailyRecords(employeeId: string, workDate: string): Promise<number> {
    const rows = await db.query.attendanceDailyRecords.findMany({
      where: and(eq(schema.attendanceDailyRecords.employeeId, employeeId), eq(schema.attendanceDailyRecords.workDate, workDate)),
    });
    return rows.length;
  }

  describe("Operation 1 — process one employee/date", () => {
    it("Test 1: scheduled workday, no attendance -> materializes ABSENT with zero worked/overtime minutes and no attendance event", async () => {
      const workDate = "2027-01-04"; // a Monday
      const result = await proc.processEmployeeAttendanceDay(ctx, { employeeId: employeeScheduledId, workDate });
      expect(result.status).toBe("ABSENT");
      expect(result.created).toBe(true);
      expect(result.record.workedMinutes).toBe(0);
      expect(result.record.overtimeMinutes).toBe(0);
      expect(result.record.scheduledMinutes).toBe(540);

      const events = await db.query.attendanceEvents.findMany({ where: eq(schema.attendanceEvents.employeeId, employeeScheduledId) });
      expect(events).toHaveLength(0);
      const sessions = await db.query.attendanceOpenSessions.findMany({
        where: eq(schema.attendanceOpenSessions.employeeId, employeeScheduledId),
      });
      expect(sessions).toHaveLength(0);
    });

    it("Test 2: scheduled workday with real attendance -> uses the existing calculation engine, not a fabricated ABSENT", async () => {
      const workDate = "2027-01-05";
      vi.setSystemTime(new Date(`${workDate}T09:00:00Z`));
      await svc.checkIn(ctx, employeeScheduledId);
      vi.setSystemTime(new Date(`${workDate}T18:00:00Z`));
      await svc.checkOut(ctx, employeeScheduledId);

      const result = await proc.processEmployeeAttendanceDay(ctx, { employeeId: employeeScheduledId, workDate });
      expect(result.status).toBe("PRESENT");
      expect(result.record.workedMinutes).toBe(540);
      expect(result.created).toBe(false); // checkOut already created the record; processing just recomputes it
    });

    it("Test 3 & 4: holiday with no attendance -> HOLIDAY; holiday with attendance -> HOLIDAY_WORKED", async () => {
      const holidayDate = "2027-01-06";
      await workforceSvc.createHoliday(ctx, { name: `Proc Test Holiday ${Date.now()}`, date: holidayDate, holidayType: "PUBLIC" });

      const noAttendance = await proc.processEmployeeAttendanceDay(ctx, { employeeId: employeeScheduledId, workDate: holidayDate });
      expect(noAttendance.status).toBe("HOLIDAY");

      vi.setSystemTime(new Date(`${holidayDate}T09:00:00Z`));
      await svc.checkIn(ctx, employeeNoScheduleId);
      vi.setSystemTime(new Date(`${holidayDate}T11:00:00Z`));
      await svc.checkOut(ctx, employeeNoScheduleId);

      const withAttendance = await proc.processEmployeeAttendanceDay(ctx, { employeeId: employeeNoScheduleId, workDate: holidayDate });
      expect(withAttendance.status).toBe("HOLIDAY_WORKED");
      expect(withAttendance.record.overtimeMinutes).toBe(withAttendance.record.workedMinutes);
    });

    it("Test 5 & 6: weekly off with no attendance -> WEEKLY_OFF; weekly off with attendance -> WEEKLY_OFF_WORKED", async () => {
      const weeklyOffDate = "2027-01-07";
      const dow = new Date(`${weeklyOffDate}T12:00:00Z`).getUTCDay();

      const employee = await employeeService.createEmployee(ctx, {
        firstName: "Proc",
        lastName: `WeeklyOff-${Date.now()}`,
        workEmail: `proc-weeklyoff-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      await workforceSvc.setEmployeeWeeklyOffOverride(ctx, employee.id, { offDays: [dow], effectiveFrom: weeklyOffDate, effectiveTo: weeklyOffDate });

      const noAttendance = await proc.processEmployeeAttendanceDay(ctx, { employeeId: employee.id, workDate: weeklyOffDate });
      expect(noAttendance.status).toBe("WEEKLY_OFF");

      const employee2 = await employeeService.createEmployee(ctx, {
        firstName: "Proc",
        lastName: `WeeklyOffWorked-${Date.now()}`,
        workEmail: `proc-weeklyoffworked-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      await workforceSvc.setEmployeeWeeklyOffOverride(ctx, employee2.id, { offDays: [dow], effectiveFrom: weeklyOffDate, effectiveTo: weeklyOffDate });
      vi.setSystemTime(new Date(`${weeklyOffDate}T09:00:00Z`));
      await svc.checkIn(ctx, employee2.id);
      vi.setSystemTime(new Date(`${weeklyOffDate}T11:00:00Z`));
      await svc.checkOut(ctx, employee2.id);

      const withAttendance = await proc.processEmployeeAttendanceDay(ctx, { employeeId: employee2.id, workDate: weeklyOffDate });
      expect(withAttendance.status).toBe("WEEKLY_OFF_WORKED");
    });

    it("Test 7 & 8: no schedule assignment, no attendance -> NO_SCHEDULE (zero minutes); no schedule with attendance -> NO_SCHEDULE with real worked minutes, null late/early, overtime = worked", async () => {
      const workDate = "2027-01-08";
      const noAttendance = await proc.processEmployeeAttendanceDay(ctx, { employeeId: employeeNoScheduleId, workDate });
      expect(noAttendance.status).toBe("NO_SCHEDULE");
      expect(noAttendance.record.scheduledMinutes).toBe(0);
      expect(noAttendance.record.workedMinutes).toBe(0);
      expect(noAttendance.record.overtimeMinutes).toBe(0);

      const employee = await employeeService.createEmployee(ctx, {
        firstName: "Proc",
        lastName: `NoScheduleWorked-${Date.now()}`,
        workEmail: `proc-noscheduleworked-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      vi.setSystemTime(new Date(`${workDate}T09:00:00Z`));
      await svc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date(`${workDate}T13:00:00Z`));
      await svc.checkOut(ctx, employee.id);

      const withAttendance = await proc.processEmployeeAttendanceDay(ctx, { employeeId: employee.id, workDate });
      expect(withAttendance.status).toBe("NO_SCHEDULE");
      expect(withAttendance.record.scheduledMinutes).toBe(0);
      expect(withAttendance.record.workedMinutes).toBe(240);
      expect(withAttendance.record.lateMinutes).toBeNull();
      expect(withAttendance.record.earlyDepartureMinutes).toBeNull();
      expect(withAttendance.record.overtimeMinutes).toBe(withAttendance.record.workedMinutes);
    });

    it("Test 9: a missing checkout stays INCOMPLETE, never ABSENT, and no checkout is fabricated", async () => {
      const workDate = "2027-01-11";
      vi.setSystemTime(new Date(`${workDate}T09:00:00Z`));
      await svc.checkIn(ctx, employeeScheduledId);

      const result = await proc.processEmployeeAttendanceDay(ctx, { employeeId: employeeScheduledId, workDate });
      expect(result.status).toBe("INCOMPLETE");
      expect(result.record.workedMinutes).toBeNull();

      const session = await db.query.attendanceOpenSessions.findFirst({
        where: and(eq(schema.attendanceOpenSessions.employeeId, employeeScheduledId), eq(schema.attendanceOpenSessions.workDate, workDate)),
      });
      expect(session!.checkOutAt).toBeNull();
    });

    it("Test 10: multiple sessions in one day are aggregated by the existing calculation engine, not assumed to be one pair", async () => {
      const workDate = "2027-01-12";
      vi.setSystemTime(new Date(`${workDate}T09:00:00Z`));
      await svc.checkIn(ctx, employeeScheduledId);
      vi.setSystemTime(new Date(`${workDate}T12:00:00Z`));
      await svc.checkOut(ctx, employeeScheduledId);
      vi.setSystemTime(new Date(`${workDate}T13:00:00Z`));
      await svc.checkIn(ctx, employeeScheduledId);
      vi.setSystemTime(new Date(`${workDate}T18:00:00Z`));
      await svc.checkOut(ctx, employeeScheduledId);

      const result = await proc.processEmployeeAttendanceDay(ctx, { employeeId: employeeScheduledId, workDate });
      expect(result.record.sessionCount).toBe(2);
      expect(result.record.workedMinutes).toBe(480); // (12-9) + (18-13) hours = 3h + 5h = 8h
    });

    it("Test 11 & 12: an approved correction affects the processed calculation; a rejected one does not", async () => {
      const workDate = "2027-01-13";
      vi.setSystemTime(new Date(`${workDate}T09:00:00Z`));
      await svc.checkIn(ctx, employeeScheduledId);
      // Forgot to check out.

      const approved = await svc.requestCorrection(ctx, employeeScheduledId, {
        workDate,
        fieldChanged: "CHECK_OUT",
        correctedValue: new Date(`${workDate}T18:00:00Z`),
        reason: "Forgot to check out",
      });
      await svc.approveCorrection(ctx, approved.id);

      const afterApproval = await proc.processEmployeeAttendanceDay(ctx, { employeeId: employeeScheduledId, workDate });
      expect(afterApproval.status).not.toBe("INCOMPLETE");
      expect(afterApproval.record.workedMinutes).toBe(540);

      // A second, independent employee/date pair for the rejected-correction half of this test.
      const workDate2 = "2027-01-14";
      vi.setSystemTime(new Date(`${workDate2}T09:00:00Z`));
      await svc.checkIn(ctx, employeeScheduledId);

      const rejected = await svc.requestCorrection(ctx, employeeScheduledId, {
        workDate: workDate2,
        fieldChanged: "CHECK_OUT",
        correctedValue: new Date(`${workDate2}T18:00:00Z`),
        reason: "Forgot to check out",
      });
      await svc.rejectCorrection(ctx, rejected.id);

      const afterRejection = await proc.processEmployeeAttendanceDay(ctx, { employeeId: employeeScheduledId, workDate: workDate2 });
      expect(afterRejection.status).toBe("INCOMPLETE");
      expect(afterRejection.record.workedMinutes).toBeNull();
    });

    it("Test 13: an archived employee is rejected and no daily record is created", async () => {
      const employee = await employeeService.createEmployee(ctx, {
        firstName: "Proc",
        lastName: `Archived-${Date.now()}`,
        workEmail: `proc-archived-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      await employeeService.archiveEmployee(ctx, employee.id);

      const workDate = "2027-01-15";
      await expect(proc.processEmployeeAttendanceDay(ctx, { employeeId: employee.id, workDate })).rejects.toThrow(
        errors.EmployeeNotEligibleForProcessingError,
      );
      expect(await countDailyRecords(employee.id, workDate)).toBe(0);
    });

    it("Test 14: an employee from a different company is rejected (tenant isolation)", async () => {
      const workDate = "2027-01-15";
      await expect(proc.processEmployeeAttendanceDay(ctxCompanyB, { employeeId: employeeScheduledId, workDate })).rejects.toThrow(
        AuthorizationError,
      );
      expect(await countDailyRecords(employeeScheduledId, workDate)).toBe(0);
    });

    it("respects dateOfJoining — an employee who joined after the target date is not eligible", async () => {
      const employee = await employeeService.createEmployee(ctx, {
        firstName: "Proc",
        lastName: `FutureJoiner-${Date.now()}`,
        workEmail: `proc-futurejoiner-${Date.now()}@test.local`,
        dateOfJoining: "2027-06-01",
        locationId: branchId,
      });
      await expect(proc.processEmployeeAttendanceDay(ctx, { employeeId: employee.id, workDate: "2027-01-15" })).rejects.toThrow(
        errors.EmployeeNotEligibleForProcessingError,
      );
    });

    it("Test 15: processing the same employee/date twice is idempotent — exactly one daily record, no duplicate correction/event side effects", async () => {
      const workDate = "2027-01-18";
      vi.setSystemTime(new Date(`${workDate}T09:00:00Z`));
      await svc.checkIn(ctx, employeeScheduledId);
      vi.setSystemTime(new Date(`${workDate}T18:00:00Z`));
      await svc.checkOut(ctx, employeeScheduledId);

      const first = await proc.processEmployeeAttendanceDay(ctx, { employeeId: employeeScheduledId, workDate });
      const second = await proc.processEmployeeAttendanceDay(ctx, { employeeId: employeeScheduledId, workDate });
      expect(first.record.id).toBe(second.record.id);
      expect(await countDailyRecords(employeeScheduledId, workDate)).toBe(1);
    });

    it("Test 16: concurrent processing of the same employee/date produces exactly one daily record", async () => {
      const workDate = "2027-01-19";
      const [a, b] = await Promise.allSettled([
        proc.processEmployeeAttendanceDay(ctx, { employeeId: employeeScheduledId, workDate }),
        proc.processEmployeeAttendanceDay(ctx, { employeeId: employeeScheduledId, workDate }),
      ]);
      expect([a, b].filter((o) => o.status === "fulfilled")).toHaveLength(2); // both succeed — upsert, not a lock conflict
      expect(await countDailyRecords(employeeScheduledId, workDate)).toBe(1);
    });
  });

  describe("Operation 2 — process company/date", () => {
    it("processes every eligible employee, excludes the archived one, and reports aggregate statistics", async () => {
      const workDate = "2027-02-01"; // a Monday, unused by any other test in this file
      const stats = await proc.processCompanyAttendanceDay(ctx, { workDate });

      expect(stats.failed).toBe(0);
      expect(stats.processed).toBe(stats.totalEmployees);
      expect(stats.statusCounts.ABSENT + stats.statusCounts.NO_SCHEDULE).toBeGreaterThan(0);

      // Running again must not create duplicates or change the totals (Test 15/9 at company scope).
      const second = await proc.processCompanyAttendanceDay(ctx, { workDate });
      expect(second.totalEmployees).toBe(stats.totalEmployees);
      expect(second.created).toBe(0); // every record already existed from the first run
      expect(second.updated).toBe(second.processed);
    });

    it("Test 17: dashboard — previously uncomputed employees disappear from the uncomputed count after processing", async () => {
      // On/after the "future joiner" fixture's own dateOfJoining (2027-06-01) so every active
      // employee the dashboard counts is also eligible for processing on this date — otherwise
      // that one fixture would always be a legitimate, expected "uncomputed" employee (they
      // hadn't joined yet), which is a dateOfJoining-eligibility case already covered by its own
      // test above, not what this test is checking.
      const workDate = "2027-06-15";
      const before = await svc.getAttendanceDashboard(ctx, { workDate, page: 1, pageSize: 10 });
      expect(before.summary.employeesWithoutRecord).toBeGreaterThan(0);

      await proc.processCompanyAttendanceDay(ctx, { workDate });

      const after = await svc.getAttendanceDashboard(ctx, { workDate, page: 1, pageSize: 10 });
      expect(after.summary.employeesWithoutRecord).toBe(0);
    });

    it("a company-wide process call never touches another company's employees", async () => {
      const workDate = "2027-02-03";
      const stats = await proc.processCompanyAttendanceDay(ctxCompanyB, { workDate });
      expect(stats.totalEmployees).toBe(0);
      expect(await countDailyRecords(employeeScheduledId, workDate)).toBe(0);
    });
  });
});
