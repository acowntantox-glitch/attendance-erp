import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";

const available = await isDatabaseAvailable();

// This suite's beforeAll does substantially more sequential real-Postgres setup than other
// attendance test files (12 employees, schedule assignments, holiday/weekly-off overrides, and a
// dozen check-in/out calls) — give it more headroom under real network latency.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

describe.skipIf(!available)("attendance dashboard", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let svc: typeof import("../service");
  let workforceSvc: typeof import("@/domains/workforce/service");
  let employeeService: typeof import("@/domains/employee/service");
  let organizationService: typeof import("@/domains/organization/service");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;

  let companyAId: string;
  let companyBId: string;
  let branchId: string;
  let engineeringDeptId: string;
  let salesDeptId: string;
  let adminUserId: string;
  let ctx: import("@/lib/auth/request-context").RequestContext;
  let ctxCompanyB: import("@/lib/auth/request-context").RequestContext;
  let ctxManager: import("@/lib/auth/request-context").RequestContext;
  let ctxHrAdmin: import("@/lib/auth/request-context").RequestContext;
  let ctxEmployee: import("@/lib/auth/request-context").RequestContext;

  const DATE = "2026-07-01"; // a Wednesday, used as the fixed dashboard test date
  const HOLIDAY_DATE = "2026-07-02";
  const WEEKLY_OFF_DATE = "2026-07-03";

  async function makeEmployee(label: string, departmentId?: string) {
    return employeeService.createEmployee(ctx, {
      firstName: "Dash",
      lastName: `${label}-${Date.now()}`,
      workEmail: `dash-${label.toLowerCase()}-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branchId,
      departmentId,
    });
  }

  let employeePresentId: string;
  let employeeLateId: string;
  let employeeIncompleteId: string;
  let employeeNoScheduleId: string;
  let employeeNoRecordId: string;
  let employeeHolidayId: string;
  let employeeHolidayWorkedId: string;
  let employeeWeeklyOffId: string;
  let employeeWeeklyOffWorkedId: string;
  let employeeWorkingId: string;
  let employeeOnBreakId: string;
  let employeeSalesId: string;

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    svc = await import("../service");
    workforceSvc = await import("@/domains/workforce/service");
    employeeService = await import("@/domains/employee/service");
    organizationService = await import("@/domains/organization/service");
    ({ AuthorizationError } = await import("@/lib/errors"));

    const [companyA] = await db
      .insert(schema.companies)
      .values({ name: "Dashboard Test Co A", code: `DASH_TEST_A_${Date.now()}`, timezone: "UTC" })
      .returning();
    const [companyB] = await db
      .insert(schema.companies)
      .values({ name: "Dashboard Test Co B", code: `DASH_TEST_B_${Date.now()}`, timezone: "UTC" })
      .returning();
    companyAId = companyA!.id;
    companyBId = companyB!.id;

    const [branch] = await db
      .insert(schema.branches)
      .values({ companyId: companyAId, name: "HQ", code: "DASH_TEST_HQ", timezone: "UTC" })
      .returning();
    branchId = branch!.id;

    const [adminUser] = await db
      .insert(schema.users)
      .values({ email: `dash-admin-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Dashboard Test Admin" })
      .returning();
    adminUserId = adminUser!.id;

    ctx = {
      requestId: "dash-test",
      userId: adminUserId,
      userEmail: adminUser!.email,
      companyId: companyAId,
      role: "COMPANY_ADMIN",
      employeeId: null,
    };
    ctxCompanyB = { ...ctx, companyId: companyBId, requestId: "dash-test-b" };
    ctxManager = { ...ctx, role: "MANAGER", requestId: "dash-test-manager" };
    ctxHrAdmin = { ...ctx, role: "HR_ADMIN", requestId: "dash-test-hradmin" };

    const engineering = await organizationService.createDepartment(ctx, { name: `Engineering-${Date.now()}`, code: `ENG_${Date.now()}` });
    const sales = await organizationService.createDepartment(ctx, { name: `Sales-${Date.now()}`, code: `SAL_${Date.now()}` });
    engineeringDeptId = engineering.id;
    salesDeptId = sales.id;

    const daySchedule = await workforceSvc.createWorkSchedule(ctx, { name: `DashDay-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });

    async function assignDaySchedule(employeeId: string) {
      await workforceSvc.assignEmployeeSchedule(ctx, employeeId, { workScheduleId: daySchedule.id, effectiveFrom: "2026-01-01" });
    }

    const present = await makeEmployee("Present", engineeringDeptId);
    employeePresentId = present.id;
    await assignDaySchedule(employeePresentId);

    const late = await makeEmployee("Late", engineeringDeptId);
    employeeLateId = late.id;
    await assignDaySchedule(employeeLateId);

    const incomplete = await makeEmployee("Incomplete", engineeringDeptId);
    employeeIncompleteId = incomplete.id;
    await assignDaySchedule(employeeIncompleteId);

    const noSchedule = await makeEmployee("NoSchedule", engineeringDeptId);
    employeeNoScheduleId = noSchedule.id;

    const noRecord = await makeEmployee("NoRecord", engineeringDeptId);
    employeeNoRecordId = noRecord.id;
    // Deliberately never touched — proves the dashboard doesn't fabricate a status for an employee
    // whose day was never computed.

    const holiday = await makeEmployee("Holiday", engineeringDeptId);
    employeeHolidayId = holiday.id;
    await assignDaySchedule(employeeHolidayId);

    const holidayWorked = await makeEmployee("HolidayWorked", engineeringDeptId);
    employeeHolidayWorkedId = holidayWorked.id;
    await assignDaySchedule(employeeHolidayWorkedId);

    const weeklyOff = await makeEmployee("WeeklyOff", engineeringDeptId);
    employeeWeeklyOffId = weeklyOff.id;
    await assignDaySchedule(employeeWeeklyOffId);

    const weeklyOffWorked = await makeEmployee("WeeklyOffWorked", engineeringDeptId);
    employeeWeeklyOffWorkedId = weeklyOffWorked.id;
    await assignDaySchedule(employeeWeeklyOffWorkedId);

    const working = await makeEmployee("Working", engineeringDeptId);
    employeeWorkingId = working.id;
    await assignDaySchedule(employeeWorkingId);

    const onBreak = await makeEmployee("OnBreak", engineeringDeptId);
    employeeOnBreakId = onBreak.id;
    await assignDaySchedule(employeeOnBreakId);

    const salesEmployee = await makeEmployee("SalesPerson", salesDeptId);
    employeeSalesId = salesEmployee.id;
    await assignDaySchedule(employeeSalesId);

    await workforceSvc.createHoliday(ctx, { name: `Dash Test Holiday ${Date.now()}`, date: HOLIDAY_DATE, holidayType: "PUBLIC" });

    const weeklyOffDow = new Date(`${WEEKLY_OFF_DATE}T12:00:00Z`).getUTCDay();
    await workforceSvc.setEmployeeWeeklyOffOverride(ctx, employeeWeeklyOffId, {
      offDays: [weeklyOffDow],
      effectiveFrom: WEEKLY_OFF_DATE,
      effectiveTo: WEEKLY_OFF_DATE,
    });
    await workforceSvc.setEmployeeWeeklyOffOverride(ctx, employeeWeeklyOffWorkedId, {
      offDays: [weeklyOffDow],
      effectiveFrom: WEEKLY_OFF_DATE,
      effectiveTo: WEEKLY_OFF_DATE,
    });

    // --- Build the actual attendance events ---
    vi.setSystemTime(new Date(`${DATE}T09:00:00Z`));
    await svc.checkIn(ctx, employeePresentId);
    vi.setSystemTime(new Date(`${DATE}T18:00:00Z`));
    await svc.checkOut(ctx, employeePresentId);

    vi.setSystemTime(new Date(`${DATE}T10:30:00Z`));
    await svc.checkIn(ctx, employeeLateId);
    vi.setSystemTime(new Date(`${DATE}T18:00:00Z`));
    await svc.checkOut(ctx, employeeLateId);

    vi.setSystemTime(new Date(`${DATE}T09:00:00Z`));
    await svc.checkIn(ctx, employeeIncompleteId); // never checked out
    // Only checkOut/getAttendanceDay trigger recalculation — without this, no daily record would
    // exist at all for this employee on this date (proving the point, but not what this fixture
    // needs), so explicitly trigger it the same way an HR view of the day would.
    await svc.getAttendanceDay(ctx, employeeIncompleteId, DATE);

    vi.setSystemTime(new Date(`${DATE}T09:00:00Z`));
    await svc.checkIn(ctx, employeeNoScheduleId);
    vi.setSystemTime(new Date(`${DATE}T13:00:00Z`));
    await svc.checkOut(ctx, employeeNoScheduleId);

    // Holiday: no check-in at all — trigger computation the same way a real HR view would.
    await svc.getAttendanceDay(ctx, employeeHolidayId, HOLIDAY_DATE);

    vi.setSystemTime(new Date(`${HOLIDAY_DATE}T09:00:00Z`));
    await svc.checkIn(ctx, employeeHolidayWorkedId);
    vi.setSystemTime(new Date(`${HOLIDAY_DATE}T13:00:00Z`));
    await svc.checkOut(ctx, employeeHolidayWorkedId);

    await svc.getAttendanceDay(ctx, employeeWeeklyOffId, WEEKLY_OFF_DATE);

    vi.setSystemTime(new Date(`${WEEKLY_OFF_DATE}T09:00:00Z`));
    await svc.checkIn(ctx, employeeWeeklyOffWorkedId);
    vi.setSystemTime(new Date(`${WEEKLY_OFF_DATE}T13:00:00Z`));
    await svc.checkOut(ctx, employeeWeeklyOffWorkedId);

    vi.useRealTimers();

    // Currently working / on break — real "now", left open deliberately.
    await svc.checkIn(ctx, employeeWorkingId);
    await svc.checkIn(ctx, employeeOnBreakId);
    await svc.startBreak(ctx, employeeOnBreakId);

    ctxEmployee = { ...ctx, role: "EMPLOYEE", employeeId: employeePresentId, requestId: "dash-test-employee" };
  });

  afterAll(async () => {
    await svc.checkOut(ctx, employeeWorkingId).catch(() => {});
    await svc.endBreak(ctx, employeeOnBreakId).catch(() => {});
    await svc.checkOut(ctx, employeeOnBreakId).catch(() => {});
    await db.delete(schema.companies).where(eq(schema.companies.id, companyAId));
    await db.delete(schema.companies).where(eq(schema.companies.id, companyBId));
    await db.delete(schema.users).where(eq(schema.users.id, adminUserId));
    await pool.end();
  });

  describe("summary", () => {
    it("counts each status correctly for the selected date, plus employees without a computed record", async () => {
      const result = await svc.getAttendanceDashboard(ctx, { workDate: DATE, page: 1, pageSize: 25 });
      expect(result.summary.statusCounts.PRESENT).toBeGreaterThanOrEqual(1);
      expect(result.summary.statusCounts.LATE).toBeGreaterThanOrEqual(1);
      expect(result.summary.statusCounts.INCOMPLETE).toBeGreaterThanOrEqual(1);
      expect(result.summary.statusCounts.NO_SCHEDULE).toBeGreaterThanOrEqual(1);
      expect(result.summary.employeesWithoutRecord).toBeGreaterThanOrEqual(1);
      expect(result.summary.totalEmployees).toBeGreaterThanOrEqual(12);

      // employeeNoRecordId was never touched — must not be attributed any status, and its row in
      // the full table must show a null record rather than a fabricated one.
      const full = await svc.getAttendanceDashboard(ctx, { workDate: DATE, page: 1, pageSize: 50 });
      const noRecordRow = full.table.items.find((row) => row.id === employeeNoRecordId);
      expect(noRecordRow).toBeDefined();
      expect(noRecordRow!.record).toBeNull();
    });

    it("counts HOLIDAY / HOLIDAY_WORKED / WEEKLY_OFF / WEEKLY_OFF_WORKED correctly on their respective dates", async () => {
      const holidayResult = await svc.getAttendanceDashboard(ctx, { workDate: HOLIDAY_DATE, page: 1, pageSize: 25 });
      expect(holidayResult.summary.statusCounts.HOLIDAY).toBeGreaterThanOrEqual(1);
      expect(holidayResult.summary.statusCounts.HOLIDAY_WORKED).toBeGreaterThanOrEqual(1);

      const weeklyOffResult = await svc.getAttendanceDashboard(ctx, { workDate: WEEKLY_OFF_DATE, page: 1, pageSize: 25 });
      expect(weeklyOffResult.summary.statusCounts.WEEKLY_OFF).toBeGreaterThanOrEqual(1);
      expect(weeklyOffResult.summary.statusCounts.WEEKLY_OFF_WORKED).toBeGreaterThanOrEqual(1);
    });
  });

  describe("attendance table: search, filters, pagination", () => {
    it("filters by status using the exact Attendance status values", async () => {
      const result = await svc.getAttendanceDashboard(ctx, { workDate: DATE, page: 1, pageSize: 25, status: "LATE" });
      expect(result.table.items.every((row) => row.record?.status === "LATE")).toBe(true);
      expect(result.table.items.some((row) => row.id === employeeLateId)).toBe(true);
    });

    it("filters by department", async () => {
      const result = await svc.getAttendanceDashboard(ctx, { workDate: DATE, page: 1, pageSize: 50, departmentId: salesDeptId });
      expect(result.table.items.every((row) => row.department?.id === salesDeptId)).toBe(true);
      expect(result.table.items.some((row) => row.id === employeeSalesId)).toBe(true);
    });

    it("searches by employee name/number", async () => {
      const employee = await svc.getAttendanceDashboard(ctx, { workDate: DATE, page: 1, pageSize: 25 });
      const target = employee.table.items.find((row) => row.id === employeeLateId)!;
      const result = await svc.getAttendanceDashboard(ctx, { workDate: DATE, page: 1, pageSize: 25, search: target.employeeNumber });
      expect(result.table.items.map((r) => r.id)).toContain(employeeLateId);
    });

    it("paginates with the requested page size", async () => {
      const pageOne = await svc.getAttendanceDashboard(ctx, { workDate: DATE, page: 1, pageSize: 3 });
      expect(pageOne.table.items).toHaveLength(3);
      expect(pageOne.table.page).toBe(1);
      expect(pageOne.table.pageSize).toBe(3);
      expect(pageOne.table.total).toBeGreaterThan(3);

      const pageTwo = await svc.getAttendanceDashboard(ctx, { workDate: DATE, page: 2, pageSize: 3 });
      const overlap = pageOne.table.items.map((r) => r.id).filter((id) => pageTwo.table.items.map((r) => r.id).includes(id));
      expect(overlap).toHaveLength(0);
    });

    it("scopes the table to the selected date only (date filtering)", async () => {
      const resultOnDate = await svc.getAttendanceDashboard(ctx, { workDate: DATE, page: 1, pageSize: 50 });
      const presentRow = resultOnDate.table.items.find((r) => r.id === employeePresentId)!;
      expect(presentRow.record?.status).toBe("PRESENT");

      const resultOtherDate = await svc.getAttendanceDashboard(ctx, { workDate: "2026-07-15", page: 1, pageSize: 50 });
      const presentRowOtherDate = resultOtherDate.table.items.find((r) => r.id === employeePresentId)!;
      expect(presentRowOtherDate.record).toBeNull(); // no record for that unrelated date
    });

    it("never turns a null late/early value into a fabricated zero", async () => {
      const result = await svc.getAttendanceDashboard(ctx, { workDate: DATE, page: 1, pageSize: 50 });
      const holidayWorkedIncluded = result.table.items.find((r) => r.id === employeeIncompleteId);
      expect(holidayWorkedIncluded?.record?.status).toBe("INCOMPLETE");
      expect(holidayWorkedIncluded?.record?.workedMinutes).toBeNull();
      expect(holidayWorkedIncluded?.record?.overtimeMinutes).toBeNull();
    });
  });

  describe("currently working", () => {
    it("lists open sessions with break state, distinguishing Working from On Break", async () => {
      const result = await svc.getAttendanceDashboard(ctx, { workDate: DATE, page: 1, pageSize: 25 });
      const working = result.currentlyWorking.find((r) => r.id === employeeWorkingId);
      const onBreak = result.currentlyWorking.find((r) => r.id === employeeOnBreakId);
      expect(working?.hasOpenBreak).toBe(false);
      expect(onBreak?.hasOpenBreak).toBe(true);
      expect(working?.session.sessionWorkedMinutes).toBeNull(); // never fabricated for an open session
    });
  });

  describe("late arrivals", () => {
    it("uses the backend-provided lateMinutes, not a recomputed value", async () => {
      const result = await svc.getAttendanceDashboard(ctx, { workDate: DATE, page: 1, pageSize: 25 });
      const late = result.lateArrivals.find((r) => r.id === employeeLateId);
      expect(late).toBeDefined();
      expect(late!.record.lateMinutes).toBeGreaterThan(0);
    });
  });

  describe("incomplete attendance", () => {
    it("lists employees with an unclosed session and never fabricates a checkout", async () => {
      const result = await svc.getAttendanceDashboard(ctx, { workDate: DATE, page: 1, pageSize: 25 });
      const incomplete = result.incompleteAttendance.find((r) => r.id === employeeIncompleteId);
      expect(incomplete).toBeDefined();
      expect(incomplete!.record.status).toBe("INCOMPLETE");
      expect(incomplete!.record.workedMinutes).toBeNull();
    });
  });

  describe("security and role access", () => {
    it("denies EMPLOYEE-role access to the dashboard", async () => {
      await expect(svc.getAttendanceDashboard(ctxEmployee, { workDate: DATE, page: 1, pageSize: 25 })).rejects.toThrow(AuthorizationError);
    });

    it("allows MANAGER access with the existing company-wide attendance.view scope (no new restriction)", async () => {
      const result = await svc.getAttendanceDashboard(ctxManager, { workDate: DATE, page: 1, pageSize: 50 });
      expect(result.table.items.some((r) => r.id === employeePresentId)).toBe(true);
    });

    it("allows HR_ADMIN access", async () => {
      const result = await svc.getAttendanceDashboard(ctxHrAdmin, { workDate: DATE, page: 1, pageSize: 25 });
      expect(result.summary.totalEmployees).toBeGreaterThan(0);
    });

    it("keeps cross-company data fully isolated — a different company's dashboard never sees these employees", async () => {
      const result = await svc.getAttendanceDashboard(ctxCompanyB, { workDate: DATE, page: 1, pageSize: 50 });
      expect(result.summary.totalEmployees).toBe(0);
      expect(result.table.items).toHaveLength(0);
      expect(result.table.items.some((r) => r.id === employeePresentId)).toBe(false);
    });
  });
});
