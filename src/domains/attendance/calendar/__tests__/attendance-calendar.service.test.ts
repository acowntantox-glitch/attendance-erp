import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../../tests/setup/db";
import { attendanceCalendarFiltersSchema } from "@/validations/attendance";
import { shiftMonth } from "../attendance-calendar.service";

const available = await isDatabaseAvailable();

// Several tests below do many sequential real-Postgres round trips (schedule/employee/session
// setup, check-in, correction request+approval, two calendar reads) — the default 5s timeout is
// occasionally too tight, same class of flakiness already documented in the other attendance
// integration test files.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

describe("shiftMonth", () => {
  it("rolls forward across a year boundary", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
  it("rolls backward across a year boundary", () => {
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  });
  it("shifts within the same year", () => {
    expect(shiftMonth("2026-09", 1)).toBe("2026-10");
    expect(shiftMonth("2026-09", -1)).toBe("2026-08");
  });
});

describe("attendanceCalendarFiltersSchema", () => {
  it("accepts a valid YYYY-MM month", () => {
    expect(attendanceCalendarFiltersSchema.safeParse({ month: "2026-09" }).success).toBe(true);
    expect(attendanceCalendarFiltersSchema.safeParse({ month: "2026-01" }).success).toBe(true);
    expect(attendanceCalendarFiltersSchema.safeParse({ month: "2026-12" }).success).toBe(true);
  });

  it.each(["2026-13", "2026-00", "2026-9", "2026", "09-2026", "2026/09", ""])("rejects an invalid month format (%s)", (month) => {
    expect(attendanceCalendarFiltersSchema.safeParse({ month }).success).toBe(false);
  });
});

describe.skipIf(!available)("attendance calendar service", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let calendarSvc: typeof import("../attendance-calendar.service");
  let attendanceSvc: typeof import("../../service");
  let processingSvc: typeof import("../../processing/attendance-processing.service");
  let organizationSvc: typeof import("@/domains/organization/service");
  let employeeService: typeof import("@/domains/employee/service");
  let workforceSvc: typeof import("@/domains/workforce/service");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;

  let companyAId: string;
  let companyBId: string;
  let adminUserId: string;
  let ctx: import("@/lib/auth/request-context").RequestContext;
  let ctxHrManager: import("@/lib/auth/request-context").RequestContext;
  let ctxManager: import("@/lib/auth/request-context").RequestContext;
  let ctxEmployee: import("@/lib/auth/request-context").RequestContext;
  let ctxCompanyB: import("@/lib/auth/request-context").RequestContext;

  let branchA1Id: string;
  let branchA2Id: string;
  let deptEngId: string;
  let deptSalesId: string;
  let emp1Id: string; // Eng / A1 — 9 real records across the month
  let emp2Id: string; // Sales / A2 — 1 real record
  let emp3Id: string; // Eng / A2 — 1 real record

  const MONTH = "2027-04";

  async function insertRecord(input: { employeeId: string; workDate: string; status: string; workedMinutes: number | null }) {
    await db.insert(schema.attendanceDailyRecords).values({
      companyId: companyAId,
      employeeId: input.employeeId,
      workDate: input.workDate,
      status: input.status as (typeof schema.attendanceDailyRecords.$inferInsert)["status"],
      scheduledMinutes: 480,
      workedMinutes: input.workedMinutes,
    });
  }

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    calendarSvc = await import("../attendance-calendar.service");
    attendanceSvc = await import("../../service");
    processingSvc = await import("../../processing/attendance-processing.service");
    organizationSvc = await import("@/domains/organization/service");
    employeeService = await import("@/domains/employee/service");
    workforceSvc = await import("@/domains/workforce/service");
    ({ AuthorizationError } = await import("@/lib/errors"));

    const [companyA] = await db
      .insert(schema.companies)
      .values({ name: "Calendar Test Co A", code: `CAL_TEST_A_${Date.now()}`, timezone: "UTC" })
      .returning();
    const [companyB] = await db
      .insert(schema.companies)
      .values({ name: "Calendar Test Co B", code: `CAL_TEST_B_${Date.now()}`, timezone: "UTC" })
      .returning();
    companyAId = companyA!.id;
    companyBId = companyB!.id;

    const [adminUser] = await db
      .insert(schema.users)
      .values({ email: `cal-admin-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Calendar Test Admin" })
      .returning();
    adminUserId = adminUser!.id;

    ctx = { requestId: "cal-test", userId: adminUserId, userEmail: adminUser!.email, companyId: companyAId, role: "COMPANY_ADMIN", employeeId: null };
    ctxHrManager = { ...ctx, role: "HR_MANAGER", requestId: "cal-test-hrm" };
    ctxManager = { ...ctx, role: "MANAGER", requestId: "cal-test-mgr" };
    ctxEmployee = { ...ctx, role: "EMPLOYEE", requestId: "cal-test-emp" };
    ctxCompanyB = { ...ctx, companyId: companyBId, requestId: "cal-test-b" };

    const branchA1 = await organizationSvc.createBranch(ctx, { name: "CalA1", code: `CAL_A1_${Date.now()}` });
    const branchA2 = await organizationSvc.createBranch(ctx, { name: "CalA2", code: `CAL_A2_${Date.now()}` });
    branchA1Id = branchA1.id;
    branchA2Id = branchA2.id;

    const deptEng = await organizationSvc.createDepartment(ctx, { name: "CalEngineering", code: `CAL_ENG_${Date.now()}` });
    const deptSales = await organizationSvc.createDepartment(ctx, { name: "CalSales", code: `CAL_SALES_${Date.now()}` });
    deptEngId = deptEng.id;
    deptSalesId = deptSales.id;

    const emp1 = await employeeService.createEmployee(ctx, {
      firstName: "Cal1",
      lastName: `Matrix-${Date.now()}`,
      workEmail: `cal-emp1-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branchA1Id,
      departmentId: deptEngId,
    });
    const emp2 = await employeeService.createEmployee(ctx, {
      firstName: "Cal2",
      lastName: `Matrix-${Date.now()}`,
      workEmail: `cal-emp2-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branchA2Id,
      departmentId: deptSalesId,
    });
    const emp3 = await employeeService.createEmployee(ctx, {
      firstName: "Cal3",
      lastName: `Matrix-${Date.now()}`,
      workEmail: `cal-emp3-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branchA2Id,
      departmentId: deptEngId,
    });
    emp1Id = emp1.id;
    emp2Id = emp2.id;
    emp3Id = emp3.id;

    const employeeB = await employeeService.createEmployee(ctxCompanyB, {
      firstName: "CalB",
      lastName: `MatrixB-${Date.now()}`,
      workEmail: `cal-empb-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
    });
    await db.insert(schema.attendanceDailyRecords).values({
      companyId: companyBId,
      employeeId: employeeB.id,
      workDate: `${MONTH}-01`,
      status: "PRESENT",
      scheduledMinutes: 480,
      workedMinutes: 480,
    });

    // emp1: 9 real records, deliberately skipping 04-04 and most of the month (unprocessed).
    await insertRecord({ employeeId: emp1Id, workDate: `${MONTH}-01`, status: "PRESENT", workedMinutes: 480 });
    await insertRecord({ employeeId: emp1Id, workDate: `${MONTH}-02`, status: "LATE", workedMinutes: 460 });
    await insertRecord({ employeeId: emp1Id, workDate: `${MONTH}-03`, status: "ABSENT", workedMinutes: 0 });
    await insertRecord({ employeeId: emp1Id, workDate: `${MONTH}-05`, status: "INCOMPLETE", workedMinutes: null });
    await insertRecord({ employeeId: emp1Id, workDate: `${MONTH}-10`, status: "HOLIDAY", workedMinutes: 0 });
    await insertRecord({ employeeId: emp1Id, workDate: `${MONTH}-11`, status: "HOLIDAY_WORKED", workedMinutes: 120 });
    await insertRecord({ employeeId: emp1Id, workDate: `${MONTH}-12`, status: "WEEKLY_OFF", workedMinutes: 0 });
    await insertRecord({ employeeId: emp1Id, workDate: `${MONTH}-13`, status: "WEEKLY_OFF_WORKED", workedMinutes: 90 });
    await insertRecord({ employeeId: emp1Id, workDate: `${MONTH}-15`, status: "NO_SCHEDULE", workedMinutes: 200 });

    await insertRecord({ employeeId: emp2Id, workDate: `${MONTH}-01`, status: "PRESENT", workedMinutes: 480 });
    await insertRecord({ employeeId: emp3Id, workDate: `${MONTH}-01`, status: "ABSENT", workedMinutes: 0 });
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

  function findCell(result: Awaited<ReturnType<typeof calendarSvc.getAttendanceCalendar>>, employeeId: string, date: string) {
    const row = result.rows.find((r) => r.employeeId === employeeId);
    return row?.cells.find((c) => c.date === date);
  }

  describe("basic matrix", () => {
    it("returns one row per matching employee and one cell per day of the month", async () => {
      const result = await calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 25 });
      expect(result.rows).toHaveLength(3);
      expect(result.days).toHaveLength(30); // April has 30 days
      expect(result.days[0]).toBe(`${MONTH}-01`);
      expect(result.days[29]).toBe(`${MONTH}-30`);
      expect(result.pagination.total).toBe(3);
    });

    it("Data integrity (§35): every real status maps through unchanged, never recomputed", async () => {
      const result = await calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 25 });
      const expectations: [string, string][] = [
        [`${MONTH}-01`, "PRESENT"],
        [`${MONTH}-02`, "LATE"],
        [`${MONTH}-03`, "ABSENT"],
        [`${MONTH}-05`, "INCOMPLETE"],
        [`${MONTH}-10`, "HOLIDAY"],
        [`${MONTH}-11`, "HOLIDAY_WORKED"],
        [`${MONTH}-12`, "WEEKLY_OFF"],
        [`${MONTH}-13`, "WEEKLY_OFF_WORKED"],
        [`${MONTH}-15`, "NO_SCHEDULE"],
      ];
      for (const [date, status] of expectations) {
        const cell = findCell(result, emp1Id, date);
        expect(cell?.status).toBe(status);
        expect(cell?.hasRecord).toBe(true);
      }
    });

    it("§36 CRITICAL — a day with no daily record is UNPROCESSED, never ABSENT", async () => {
      const result = await calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 25 });
      const cell = findCell(result, emp1Id, `${MONTH}-04`);
      expect(cell?.status).toBe("UNPROCESSED");
      expect(cell?.hasRecord).toBe(false);
      expect(cell?.status).not.toBe("ABSENT");

      const dbRow = await db.query.attendanceDailyRecords.findFirst({
        where: (t, { and: dbAnd, eq: dbEq }) => dbAnd(dbEq(t.employeeId, emp1Id), dbEq(t.workDate, `${MONTH}-04`)),
      });
      expect(dbRow).toBeUndefined();
    });

    it("§37 — a future date (this whole test month is in the future) without a record is UNPROCESSED, never ABSENT", async () => {
      const result = await calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 25 });
      const cell = findCell(result, emp1Id, `${MONTH}-25`);
      expect(cell?.status).toBe("UNPROCESSED");
      expect(cell?.status).not.toBe("ABSENT");
    });

    it("row totals reflect only this employee's real records for the month", async () => {
      const result = await calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 25 });
      const row = result.rows.find((r) => r.employeeId === emp1Id)!;
      expect(row.totals).toMatchObject({
        PRESENT: 1,
        LATE: 1,
        ABSENT: 1,
        INCOMPLETE: 1,
        HOLIDAY: 1,
        HOLIDAY_WORKED: 1,
        WEEKLY_OFF: 1,
        WEEKLY_OFF_WORKED: 1,
        NO_SCHEDULE: 1,
      });
    });
  });

  describe("filters", () => {
    it("department filter — only employees in the selected department", async () => {
      const result = await calendarSvc.getAttendanceCalendar(ctx, MONTH, { departmentId: deptEngId }, { page: 1, pageSize: 25 });
      expect(result.rows.map((r) => r.employeeId).sort()).toEqual([emp1Id, emp3Id].sort());
    });

    it("location filter — only employees at the selected branch", async () => {
      const result = await calendarSvc.getAttendanceCalendar(ctx, MONTH, { locationId: branchA2Id }, { page: 1, pageSize: 25 });
      expect(result.rows.map((r) => r.employeeId).sort()).toEqual([emp2Id, emp3Id].sort());
    });

    it("search — matches employee last name and employee number", async () => {
      const empRow = await db.query.employees.findFirst({ where: eq(schema.employees.id, emp1Id) });
      const byNumber = await calendarSvc.getAttendanceCalendar(ctx, MONTH, { search: empRow!.employeeNumber }, { page: 1, pageSize: 25 });
      expect(byNumber.rows).toHaveLength(1);
      expect(byNumber.rows[0]!.employeeId).toBe(emp1Id);
    });
  });

  describe("pagination and unpaginated totals", () => {
    it("paginates employees, and daily totals/summary still reflect the full filtered population, not just the current page", async () => {
      const page1 = await calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 1 });
      expect(page1.rows).toHaveLength(1);
      expect(page1.pagination).toMatchObject({ page: 1, pageSize: 1, total: 3, totalPages: 3 });

      // Regardless of which single employee is on this page, the day-1 daily total must count
      // all 3 employees' real 04-01 records (2 PRESENT + 1 ABSENT).
      const day1Totals = page1.dailyTotals.find((d) => d.date === `${MONTH}-01`)!;
      expect(day1Totals.statusCounts.PRESENT).toBe(2);
      expect(day1Totals.statusCounts.ABSENT).toBe(1);

      expect(page1.summary.totalEmployees).toBe(3);
      expect(page1.summary.processedEmployeeDays).toBe(11); // 9 (emp1) + 1 (emp2) + 1 (emp3)
      expect(page1.summary.possibleEmployeeDays).toBe(3 * 30);
      expect(page1.summary.unprocessedEmployeeDays).toBe(3 * 30 - 11);
      expect(page1.summary.statusCounts).toMatchObject({ PRESENT: 2, ABSENT: 2, LATE: 1, INCOMPLETE: 1, HOLIDAY: 1, HOLIDAY_WORKED: 1, WEEKLY_OFF: 1, WEEKLY_OFF_WORKED: 1, NO_SCHEDULE: 1 });
    });
  });

  describe("tenant isolation and RBAC", () => {
    it("Company A's calendar never includes Company B's employee, and Company B cannot see Company A's department/employee ids", async () => {
      const companyAResult = await calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 25 });
      expect(companyAResult.pagination.total).toBe(3); // never 4

      const crossDepartment = await calendarSvc.getAttendanceCalendar(ctxCompanyB, MONTH, { departmentId: deptEngId }, { page: 1, pageSize: 25 });
      expect(crossDepartment.pagination.total).toBe(0);

      const crossLocation = await calendarSvc.getAttendanceCalendar(ctxCompanyB, MONTH, { locationId: branchA1Id }, { page: 1, pageSize: 25 });
      expect(crossLocation.pagination.total).toBe(0);
    });

    it("HR_ADMIN and HR_MANAGER can view the calendar; MANAGER and EMPLOYEE are rejected", async () => {
      await expect(calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 25 })).resolves.toBeDefined();
      await expect(calendarSvc.getAttendanceCalendar(ctxHrManager, MONTH, {}, { page: 1, pageSize: 25 })).resolves.toBeDefined();
      await expect(calendarSvc.getAttendanceCalendar(ctxManager, MONTH, {}, { page: 1, pageSize: 25 })).rejects.toThrow(AuthorizationError);
      await expect(calendarSvc.getAttendanceCalendar(ctxEmployee, MONTH, {}, { page: 1, pageSize: 25 })).rejects.toThrow(AuthorizationError);
    });
  });

  describe("end-to-end wiring (no calculation logic duplicated in the calendar)", () => {
    it("§39 — an approved correction's recalculated outcome is reflected by the next calendar read", async () => {
      const correctionSchedule = await workforceSvc.createWorkSchedule(ctx, { name: `CalCorrSchedule-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      const employee = await employeeService.createEmployee(ctx, {
        firstName: "CalCorr",
        lastName: `Matrix-${Date.now()}`,
        workEmail: `cal-corr-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
      });
      // A real schedule assignment is required for a missing checkout to read as INCOMPLETE
      // rather than NO_SCHEDULE (`calculateDailyAttendance`'s own, pre-existing precedence rule —
      // "sessions exist but no expectation period" always short-circuits to NO_SCHEDULE).
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: correctionSchedule.id, effectiveFrom: "2020-01-01" });
      const workDate = `${MONTH}-20`;
      vi.setSystemTime(new Date(`${workDate}T09:00:00Z`));
      await attendanceSvc.checkIn(ctx, employee.id);
      // Forgot to check out. Check-in alone never creates a daily record (only check-out or an
      // explicit recalculation/processing does) — recalculate once so there is something for the
      // "before" calendar read to see at all, matching a real HR workflow where the day would
      // already have been processed before anyone looks at the calendar.
      await attendanceSvc.recalculateDailyRecord(ctx, employee.id, workDate);

      const before = await calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 100 });
      expect(findCell(before, employee.id, workDate)?.status).toBe("INCOMPLETE");

      const correction = await attendanceSvc.requestCorrection(ctx, employee.id, {
        workDate,
        fieldChanged: "CHECK_OUT",
        correctedValue: new Date(`${workDate}T18:00:00Z`),
        reason: "Forgot to check out",
      });
      await attendanceSvc.approveCorrection(ctx, correction.id);

      const after = await calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 100 });
      const cell = findCell(after, employee.id, workDate);
      expect(cell?.status).not.toBe("INCOMPLETE");
      expect(cell?.workedMinutes).toBe(540);
    });

    it("§40 — processing a previously unprocessed day materializes the correct status on the next calendar read", async () => {
      const daySchedule = await workforceSvc.createWorkSchedule(ctx, { name: `CalProc-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      const employee = await employeeService.createEmployee(ctx, {
        firstName: "CalProc",
        lastName: `Matrix-${Date.now()}`,
        workEmail: `cal-proc-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
      });
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: daySchedule.id, effectiveFrom: "2020-01-01" });

      const workDate = `${MONTH}-22`;
      const before = await calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 100 });
      expect(findCell(before, employee.id, workDate)?.status).toBe("UNPROCESSED");

      await processingSvc.processEmployeeAttendanceDay(ctx, { employeeId: employee.id, workDate });

      const after = await calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 100 });
      const cell = findCell(after, employee.id, workDate);
      expect(cell?.status).toBe("ABSENT"); // scheduled workday, no attendance, never checked in
      expect(cell?.hasRecord).toBe(true);
    });

    it("§41 — reading the calendar (repeatedly) never mutates attendance_events, sessions, or daily records", async () => {
      // Scoped to this test file's own company: other test FILES run concurrently in separate
      // vitest worker processes against the same database and write to these same tables from
      // their own, unrelated fixtures — an unscoped count would be comparing against a moving
      // target that has nothing to do with this test.
      const countForThisCompany = () =>
        db
          .select({ n: schema.attendanceDailyRecords.id })
          .from(schema.attendanceDailyRecords)
          .where(eq(schema.attendanceDailyRecords.companyId, companyAId));

      const before = await countForThisCompany();
      await calendarSvc.getAttendanceCalendar(ctx, MONTH, {}, { page: 1, pageSize: 25 });
      await calendarSvc.getAttendanceCalendar(ctx, MONTH, { departmentId: deptEngId }, { page: 1, pageSize: 25 });
      const after = await countForThisCompany();
      expect(after.length).toBe(before.length);
    });
  });
});
