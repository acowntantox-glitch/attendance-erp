import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../../tests/setup/db";

const available = await isDatabaseAvailable();

vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

/**
 * Batch 10 — attendance exception queue. Detection is tested by inserting
 * `attendance_daily_records` rows directly (the exact same fixture technique
 * `attendance-calendar.service.test.ts` uses) rather than exercising check-in/check-out — this
 * suite tests the exception repository/service's own query and dismissal logic, not
 * `calculateDailyAttendance` (already covered by `calculation.test.ts`).
 */
describe.skipIf(!available)("attendance exception service", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let exceptionSvc: typeof import("../attendance-exception.service");
  let periodSvc: typeof import("../../periods/attendance-period.service");
  let attendanceSvc: typeof import("../../service");
  let employeeService: typeof import("@/domains/employee/service");
  let errors: typeof import("../../errors");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;

  let companyAId: string;
  let companyBId: string;
  let branchAId: string;
  let deptEngId: string;
  let deptSalesId: string;
  let adminUserId: string;
  let ctx: import("@/lib/auth/request-context").RequestContext; // COMPANY_ADMIN, company A
  let ctxHrAdmin: import("@/lib/auth/request-context").RequestContext;
  let ctxHrManager: import("@/lib/auth/request-context").RequestContext;
  let ctxManager: import("@/lib/auth/request-context").RequestContext;
  let ctxEmployee: import("@/lib/auth/request-context").RequestContext;
  let ctxCompanyB: import("@/lib/auth/request-context").RequestContext;

  let employeeCounter = 0;

  function ctxFor(overrides: Partial<import("@/lib/auth/request-context").RequestContext>) {
    return { ...ctx, requestId: `exc-test-${Date.now()}-${Math.random()}`, ...overrides };
  }

  async function newEmployee(overrides: { departmentId?: string; locationId?: string; companyCtx?: typeof ctx } = {}) {
    employeeCounter += 1;
    return employeeService.createEmployee(overrides.companyCtx ?? ctx, {
      firstName: "Exc",
      lastName: `Test-${Date.now()}-${employeeCounter}`,
      workEmail: `exc-test-${Date.now()}-${employeeCounter}@test.local`,
      dateOfJoining: "2020-01-01",
      departmentId: overrides.departmentId,
      locationId: overrides.locationId ?? branchAId,
    });
  }

  async function insertRecord(input: {
    employeeId: string;
    workDate: string;
    status: string;
    workedMinutes?: number | null;
    lateMinutes?: number | null;
    earlyDepartureMinutes?: number | null;
    companyId?: string;
  }) {
    await db.insert(schema.attendanceDailyRecords).values({
      companyId: input.companyId ?? companyAId,
      employeeId: input.employeeId,
      workDate: input.workDate,
      status: input.status as (typeof schema.attendanceDailyRecords.$inferInsert)["status"],
      scheduledMinutes: 480,
      workedMinutes: input.workedMinutes ?? null,
      lateMinutes: input.lateMinutes ?? null,
      earlyDepartureMinutes: input.earlyDepartureMinutes ?? null,
    });
  }

  async function counts(companyId: string) {
    const [dailyRecords, events, openSessions, corrections, dismissals] = await Promise.all([
      db.select({ id: schema.attendanceDailyRecords.id }).from(schema.attendanceDailyRecords).where(eq(schema.attendanceDailyRecords.companyId, companyId)).then((r) => r.length),
      db.select({ id: schema.attendanceEvents.id }).from(schema.attendanceEvents).where(eq(schema.attendanceEvents.companyId, companyId)).then((r) => r.length),
      db.select({ id: schema.attendanceOpenSessions.id }).from(schema.attendanceOpenSessions).where(eq(schema.attendanceOpenSessions.companyId, companyId)).then((r) => r.length),
      db.select({ id: schema.attendanceCorrections.id }).from(schema.attendanceCorrections).where(eq(schema.attendanceCorrections.companyId, companyId)).then((r) => r.length),
      db.select({ id: schema.attendanceExceptionDismissals.id }).from(schema.attendanceExceptionDismissals).where(eq(schema.attendanceExceptionDismissals.companyId, companyId)).then((r) => r.length),
    ]);
    return { dailyRecords, events, openSessions, corrections, dismissals };
  }

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    exceptionSvc = await import("../attendance-exception.service");
    periodSvc = await import("../../periods/attendance-period.service");
    attendanceSvc = await import("../../service");
    employeeService = await import("@/domains/employee/service");
    errors = await import("../../errors");
    ({ AuthorizationError } = await import("@/lib/errors"));

    const [companyA] = await db.insert(schema.companies).values({ name: "Exception Test Co A", code: `EXC_TEST_A_${Date.now()}`, timezone: "UTC" }).returning();
    const [companyB] = await db.insert(schema.companies).values({ name: "Exception Test Co B", code: `EXC_TEST_B_${Date.now()}`, timezone: "UTC" }).returning();
    companyAId = companyA!.id;
    companyBId = companyB!.id;

    const [adminUser] = await db.insert(schema.users).values({ email: `exc-admin-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Exception Test Admin" }).returning();
    adminUserId = adminUser!.id;

    ctx = { requestId: "exc-test", userId: adminUserId, userEmail: adminUser!.email, companyId: companyAId, role: "COMPANY_ADMIN", employeeId: null };
    ctxHrAdmin = ctxFor({ role: "HR_ADMIN" });
    ctxHrManager = ctxFor({ role: "HR_MANAGER" });
    ctxManager = ctxFor({ role: "MANAGER" });
    ctxEmployee = ctxFor({ role: "EMPLOYEE" });
    ctxCompanyB = ctxFor({ companyId: companyBId });

    const [branchA] = await db.insert(schema.branches).values({ companyId: companyAId, name: "Exc HQ", code: `EXC_HQ_${Date.now()}`, timezone: "UTC" }).returning();
    branchAId = branchA!.id;
    const [branchB] = await db.insert(schema.branches).values({ companyId: companyAId, name: "Exc Remote", code: `EXC_REMOTE_${Date.now()}`, timezone: "UTC" }).returning();
    const branchBId = branchB!.id;

    const deptEng = await import("@/domains/organization/service").then((m) => m.createDepartment(ctx, { name: "ExcEngineering", code: `EXC_ENG_${Date.now()}` }));
    const deptSales = await import("@/domains/organization/service").then((m) => m.createDepartment(ctx, { name: "ExcSales", code: `EXC_SALES_${Date.now()}` }));
    deptEngId = deptEng.id;
    deptSalesId = deptSales.id;

    void branchBId;
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

  describe("detection", () => {
    it("1. LATE", async () => {
      const MONTH = "2034-01";
      const WORK_DATE = `${MONTH}-05`;
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "LATE", lateMinutes: 24 });

      const result = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: `${MONTH}-01`, toDate: `${MONTH}-28` }, { page: 1, pageSize: 25 });
      const row = result.items.find((r) => r.employeeId === employee.id);
      expect(row?.exceptionType).toBe("LATE");
      expect(row?.lateMinutes).toBe(24);
      expect(row?.periodClosed).toBe(false);
      expect(row?.dismissal).toBeNull();
    });

    it("2. INCOMPLETE", async () => {
      const MONTH = "2034-01";
      const WORK_DATE = `${MONTH}-06`;
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "INCOMPLETE" });

      const result = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: WORK_DATE, toDate: WORK_DATE }, { page: 1, pageSize: 25 });
      expect(result.items.find((r) => r.employeeId === employee.id)?.exceptionType).toBe("INCOMPLETE");
    });

    it("3. ABSENT", async () => {
      const MONTH = "2034-01";
      const WORK_DATE = `${MONTH}-07`;
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT", workedMinutes: 0 });

      const result = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: WORK_DATE, toDate: WORK_DATE }, { page: 1, pageSize: 25 });
      expect(result.items.find((r) => r.employeeId === employee.id)?.exceptionType).toBe("ABSENT");
    });

    it("4. EARLY_DEPARTURE (status PRESENT but left early)", async () => {
      const MONTH = "2034-01";
      const WORK_DATE = `${MONTH}-08`;
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "PRESENT", workedMinutes: 360, earlyDepartureMinutes: 120 });

      const result = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: WORK_DATE, toDate: WORK_DATE }, { page: 1, pageSize: 25 });
      const row = result.items.find((r) => r.employeeId === employee.id);
      expect(row?.exceptionType).toBe("EARLY_DEPARTURE");
      expect(row?.earlyDepartureMinutes).toBe(120);
      expect(row?.status).toBe("PRESENT");
    });

    it("a PRESENT day with zero early departure is never an exception", async () => {
      const WORK_DATE = "2034-01-09";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "PRESENT", workedMinutes: 480, earlyDepartureMinutes: 0 });

      const result = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: WORK_DATE, toDate: WORK_DATE }, { page: 1, pageSize: 25 });
      expect(result.items.find((r) => r.employeeId === employee.id)).toBeUndefined();
    });

    it("5. multiple exception types filter (LATE + ABSENT only, excludes INCOMPLETE)", async () => {
      const MONTH = "2034-02";
      const lateEmp = await newEmployee();
      const absentEmp = await newEmployee();
      const incompleteEmp = await newEmployee();
      await insertRecord({ employeeId: lateEmp.id, workDate: `${MONTH}-01`, status: "LATE", lateMinutes: 10 });
      await insertRecord({ employeeId: absentEmp.id, workDate: `${MONTH}-01`, status: "ABSENT" });
      await insertRecord({ employeeId: incompleteEmp.id, workDate: `${MONTH}-01`, status: "INCOMPLETE" });

      const result = await exceptionSvc.listAttendanceExceptions(
        ctx,
        { fromDate: `${MONTH}-01`, toDate: `${MONTH}-01`, types: ["LATE", "ABSENT"] },
        { page: 1, pageSize: 25 },
      );
      const ids = result.items.map((r) => r.employeeId);
      expect(ids).toContain(lateEmp.id);
      expect(ids).toContain(absentEmp.id);
      expect(ids).not.toContain(incompleteEmp.id);
    });

    it("6. multiple employees on the same date all appear", async () => {
      const WORK_DATE = "2034-02-10";
      const empA = await newEmployee();
      const empB = await newEmployee();
      await insertRecord({ employeeId: empA.id, workDate: WORK_DATE, status: "LATE", lateMinutes: 5 });
      await insertRecord({ employeeId: empB.id, workDate: WORK_DATE, status: "ABSENT" });

      const result = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: WORK_DATE, toDate: WORK_DATE }, { page: 1, pageSize: 25 });
      const ids = result.items.map((r) => r.employeeId);
      expect(ids).toContain(empA.id);
      expect(ids).toContain(empB.id);
    });

    it("7. date range excludes rows outside it", async () => {
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: "2034-03-01", status: "ABSENT" });
      await insertRecord({ employeeId: employee.id, workDate: "2034-03-15", status: "ABSENT" });

      const result = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: "2034-03-01", toDate: "2034-03-05" }, { page: 1, pageSize: 25 });
      const dates = result.items.filter((r) => r.employeeId === employee.id).map((r) => r.workDate);
      expect(dates).toEqual(["2034-03-01"]);
    });

    it("8. department filter", async () => {
      const WORK_DATE = "2034-03-20";
      const engEmp = await newEmployee({ departmentId: deptEngId });
      const salesEmp = await newEmployee({ departmentId: deptSalesId });
      await insertRecord({ employeeId: engEmp.id, workDate: WORK_DATE, status: "ABSENT" });
      await insertRecord({ employeeId: salesEmp.id, workDate: WORK_DATE, status: "ABSENT" });

      const result = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: WORK_DATE, toDate: WORK_DATE, departmentId: deptEngId }, { page: 1, pageSize: 25 });
      const ids = result.items.map((r) => r.employeeId);
      expect(ids).toContain(engEmp.id);
      expect(ids).not.toContain(salesEmp.id);
    });

    it("9. location filter", async () => {
      const WORK_DATE = "2034-03-21";
      const [otherBranch] = await db.insert(schema.branches).values({ companyId: companyAId, name: "Exc Other", code: `EXC_OTHER_${Date.now()}`, timezone: "UTC" }).returning();
      const empHQ = await newEmployee({ locationId: branchAId });
      const empOther = await newEmployee({ locationId: otherBranch!.id });
      await insertRecord({ employeeId: empHQ.id, workDate: WORK_DATE, status: "ABSENT" });
      await insertRecord({ employeeId: empOther.id, workDate: WORK_DATE, status: "ABSENT" });

      const result = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: WORK_DATE, toDate: WORK_DATE, locationId: branchAId }, { page: 1, pageSize: 25 });
      const ids = result.items.map((r) => r.employeeId);
      expect(ids).toContain(empHQ.id);
      expect(ids).not.toContain(empOther.id);
    });

    it("10. employee search (by employee number)", async () => {
      const WORK_DATE = "2034-03-22";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });

      const result = await exceptionSvc.listAttendanceExceptions(
        ctx,
        { fromDate: WORK_DATE, toDate: WORK_DATE, search: employee.employeeNumber },
        { page: 1, pageSize: 25 },
      );
      expect(result.items.map((r) => r.employeeId)).toEqual([employee.id]);
    });

    it("11. pagination", async () => {
      const MONTH = "2034-04";
      const employees = await Promise.all(Array.from({ length: 5 }, () => newEmployee()));
      await Promise.all(employees.map((e, i) => insertRecord({ employeeId: e.id, workDate: `${MONTH}-${String(i + 1).padStart(2, "0")}`, status: "ABSENT" })));

      const page1 = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: `${MONTH}-01`, toDate: `${MONTH}-05` }, { page: 1, pageSize: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.pagination).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });

      const page3 = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: `${MONTH}-01`, toDate: `${MONTH}-05` }, { page: 3, pageSize: 2 });
      expect(page3.items).toHaveLength(1);
    });

    it("12. deterministic ordering (workDate DESC, name ASC)", async () => {
      const MONTH = "2034-05";
      const empA = await newEmployee();
      const empB = await newEmployee();
      await insertRecord({ employeeId: empA.id, workDate: `${MONTH}-01`, status: "ABSENT" });
      await insertRecord({ employeeId: empB.id, workDate: `${MONTH}-02`, status: "ABSENT" });

      const first = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: `${MONTH}-01`, toDate: `${MONTH}-02` }, { page: 1, pageSize: 25 });
      const second = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: `${MONTH}-01`, toDate: `${MONTH}-02` }, { page: 1, pageSize: 25 });
      expect(first.items.map((r) => `${r.employeeId}-${r.workDate}`)).toEqual(second.items.map((r) => `${r.employeeId}-${r.workDate}`));
      // Most recent work date first.
      expect(first.items[0]!.workDate >= first.items[first.items.length - 1]!.workDate).toBe(true);
    });
  });

  describe("dismissal", () => {
    it("13. dismiss", async () => {
      const WORK_DATE = "2034-06-01";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "LATE", lateMinutes: 15 });

      const dismissal = await exceptionSvc.dismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "LATE" });
      expect(dismissal.employeeId).toBe(employee.id);
      expect(dismissal.dismissedByUserId).toBe(adminUserId);
    });

    it("14. dismiss with note", async () => {
      const WORK_DATE = "2034-06-02";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });

      const dismissal = await exceptionSvc.dismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT", note: "Approved leave, handled outside system" });
      expect(dismissal.note).toBe("Approved leave, handled outside system");
    });

    it("15. idempotent dismiss — repeated dismiss never creates a duplicate row", async () => {
      const WORK_DATE = "2034-06-03";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });

      await exceptionSvc.dismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT", note: "first" });
      await exceptionSvc.dismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT", note: "second" });

      const rows = await db.query.attendanceExceptionDismissals.findMany({
        where: (t, { and, eq: dbEq }) => and(dbEq(t.employeeId, employee.id), dbEq(t.workDate, WORK_DATE)),
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.note).toBe("second");
    });

    it("16. undismiss removes dismissal metadata", async () => {
      const WORK_DATE = "2034-06-04";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });
      await exceptionSvc.dismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" });

      await exceptionSvc.undismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" });

      const row = await db.query.attendanceExceptionDismissals.findFirst({
        where: (t, { and, eq: dbEq }) => and(dbEq(t.employeeId, employee.id), dbEq(t.workDate, WORK_DATE)),
      });
      expect(row).toBeUndefined();
      await expect(exceptionSvc.undismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" })).rejects.toThrow(
        errors.AttendanceExceptionDismissalNotFoundError,
      );
    });

    it("17. dismissed rows are excluded from the default (hide-dismissed) list", async () => {
      const WORK_DATE = "2034-06-05";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });

      const before = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: WORK_DATE, toDate: WORK_DATE }, { page: 1, pageSize: 25 });
      expect(before.items.map((r) => r.employeeId)).toContain(employee.id);

      await exceptionSvc.dismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" });

      const after = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: WORK_DATE, toDate: WORK_DATE }, { page: 1, pageSize: 25 });
      expect(after.items.map((r) => r.employeeId)).not.toContain(employee.id);
    });

    it("18. show-dismissed reveals the row again, with dismissal detail attached", async () => {
      const WORK_DATE = "2034-06-06";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });
      await exceptionSvc.dismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT", note: "handled" });

      const result = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: WORK_DATE, toDate: WORK_DATE, includeDismissed: true }, { page: 1, pageSize: 25 });
      const row = result.items.find((r) => r.employeeId === employee.id);
      expect(row?.dismissal?.note).toBe("handled");
      expect(row?.dismissal?.dismissedAt).toBeInstanceOf(Date);
    });

    it("19. dismiss and undismiss are audited", async () => {
      const WORK_DATE = "2034-06-07";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });

      const dismissal = await exceptionSvc.dismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" });
      await exceptionSvc.undismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" });

      const dismissLog = await db.query.auditLogs.findFirst({
        where: (t, { and, eq: dbEq }) => and(dbEq(t.action, "attendance.exception.dismiss"), dbEq(t.entityId, dismissal.id)),
      });
      const undismissLog = await db.query.auditLogs.findFirst({
        where: (t, { and, eq: dbEq }) => and(dbEq(t.action, "attendance.exception.undismiss"), dbEq(t.entityId, dismissal.id)),
      });
      expect(dismissLog).toBeDefined();
      expect(undismissLog).toBeDefined();
      expect((dismissLog?.metadata as { workDate?: string })?.workDate).toBe(WORK_DATE);
    });

    it("dismissing a combination that is not currently a live exception is rejected", async () => {
      const employee = await newEmployee();
      await expect(
        exceptionSvc.dismissException(ctx, { employeeId: employee.id, workDate: "2034-06-08", exceptionType: "LATE" }),
      ).rejects.toThrow(errors.AttendanceExceptionNotFoundError);
    });
  });

  describe("security", () => {
    it("20/21. HR_ADMIN and HR_MANAGER can view and dismiss", async () => {
      const WORK_DATE = "2034-07-01";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });

      await expect(exceptionSvc.listAttendanceExceptions(ctxHrAdmin, { fromDate: WORK_DATE, toDate: WORK_DATE }, { page: 1, pageSize: 25 })).resolves.toBeDefined();
      await expect(exceptionSvc.listAttendanceExceptions(ctxHrManager, { fromDate: WORK_DATE, toDate: WORK_DATE }, { page: 1, pageSize: 25 })).resolves.toBeDefined();
      await expect(exceptionSvc.dismissException(ctxHrAdmin, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" })).resolves.toBeDefined();
      await exceptionSvc.undismissException(ctxHrAdmin, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" });
      await expect(exceptionSvc.dismissException(ctxHrManager, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" })).resolves.toBeDefined();
    });

    it("22. MANAGER is denied both view and dismiss", async () => {
      const WORK_DATE = "2034-07-02";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });

      await expect(exceptionSvc.listAttendanceExceptions(ctxManager, { fromDate: WORK_DATE, toDate: WORK_DATE }, { page: 1, pageSize: 25 })).rejects.toThrow(AuthorizationError);
      await expect(exceptionSvc.dismissException(ctxManager, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" })).rejects.toThrow(AuthorizationError);
    });

    it("23. EMPLOYEE is denied both view and dismiss", async () => {
      const WORK_DATE = "2034-07-03";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });

      await expect(exceptionSvc.listAttendanceExceptions(ctxEmployee, { fromDate: WORK_DATE, toDate: WORK_DATE }, { page: 1, pageSize: 25 })).rejects.toThrow(AuthorizationError);
      await expect(exceptionSvc.dismissException(ctxEmployee, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" })).rejects.toThrow(AuthorizationError);
    });

    it("24. cross-company isolation — company B never sees company A's exceptions, and cannot dismiss them", async () => {
      const WORK_DATE = "2034-07-04";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });

      const crossResult = await exceptionSvc.listAttendanceExceptions(ctxCompanyB, { fromDate: WORK_DATE, toDate: WORK_DATE }, { page: 1, pageSize: 25 });
      expect(crossResult.items.map((r) => r.employeeId)).not.toContain(employee.id);

      await expect(exceptionSvc.dismissException(ctxCompanyB, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" })).rejects.toThrow(AuthorizationError);
    });
  });

  describe("period lock", () => {
    it("25/27. a closed-period exception remains visible and is still dismissible", async () => {
      const MONTH = "2034-08";
      const WORK_DATE = `${MONTH}-01`;
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });
      await periodSvc.closeAttendancePeriod(ctx, MONTH);

      const result = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: WORK_DATE, toDate: WORK_DATE }, { page: 1, pageSize: 25 });
      const row = result.items.find((r) => r.employeeId === employee.id);
      expect(row).toBeDefined();
      expect(row?.periodClosed).toBe(true);

      await expect(exceptionSvc.dismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" })).resolves.toBeDefined();
    });

    it("26. a correction action for a closed-period exception is still rejected by the underlying guard (no bypass)", async () => {
      const MONTH = "2034-09";
      const WORK_DATE = `${MONTH}-01`;
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });
      await periodSvc.closeAttendancePeriod(ctx, MONTH);

      await expect(
        attendanceSvc.requestCorrection(ctx, employee.id, {
          workDate: WORK_DATE,
          fieldChanged: "CHECK_IN",
          correctedValue: new Date(`${WORK_DATE}T09:00:00Z`),
          reason: "Testing closed-period rejection from the exception queue's correction action",
        }),
      ).rejects.toThrow(errors.AttendancePeriodLockedError);
    });
  });

  describe("integrity", () => {
    it("28. reading the queue causes no attendance mutation", async () => {
      const WORK_DATE = "2034-10-01";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });

      const before = await counts(companyAId);
      await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: WORK_DATE, toDate: WORK_DATE }, { page: 1, pageSize: 25 });
      const after = await counts(companyAId);
      expect(after).toEqual(before);
    });

    it("29. dismissing changes only attendance_exception_dismissals (and audit_logs)", async () => {
      const WORK_DATE = "2034-10-02";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });

      const before = await counts(companyAId);
      await exceptionSvc.dismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" });
      const after = await counts(companyAId);

      expect(after.dailyRecords).toBe(before.dailyRecords);
      expect(after.events).toBe(before.events);
      expect(after.openSessions).toBe(before.openSessions);
      expect(after.corrections).toBe(before.corrections);
      expect(after.dismissals).toBe(before.dismissals + 1);
    });

    it("30. undismissing changes only attendance_exception_dismissals (and audit_logs)", async () => {
      const WORK_DATE = "2034-10-03";
      const employee = await newEmployee();
      await insertRecord({ employeeId: employee.id, workDate: WORK_DATE, status: "ABSENT" });
      await exceptionSvc.dismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" });

      const before = await counts(companyAId);
      await exceptionSvc.undismissException(ctx, { employeeId: employee.id, workDate: WORK_DATE, exceptionType: "ABSENT" });
      const after = await counts(companyAId);

      expect(after.dailyRecords).toBe(before.dailyRecords);
      expect(after.events).toBe(before.events);
      expect(after.openSessions).toBe(before.openSessions);
      expect(after.corrections).toBe(before.corrections);
      expect(after.dismissals).toBe(before.dismissals - 1);
    });
  });

  describe("unprocessed", () => {
    it("31. a work date with no daily record at all never appears as an exception row", async () => {
      const employee = await newEmployee();
      // Deliberately no insertRecord call — this employee/date has no attendance_daily_records
      // row at all (the calendar/period sense of "unprocessed").
      const result = await exceptionSvc.listAttendanceExceptions(ctx, { fromDate: "2034-11-01", toDate: "2034-11-01" }, { page: 1, pageSize: 25 });
      expect(result.items.map((r) => r.employeeId)).not.toContain(employee.id);
    });
  });
});
