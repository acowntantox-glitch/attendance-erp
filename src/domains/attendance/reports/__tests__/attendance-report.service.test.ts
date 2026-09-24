import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../../tests/setup/db";

const available = await isDatabaseAvailable();

describe.skipIf(!available)("attendance report service", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let reportSvc: typeof import("../attendance-report.service");
  let organizationSvc: typeof import("@/domains/organization/service");
  let employeeService: typeof import("@/domains/employee/service");
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
  let emp1Id: string; // Eng / A1
  let emp2Id: string; // Sales / A2
  let emp3Id: string; // Eng / A2

  const FULL_RANGE = { fromDate: "2027-03-01", toDate: "2027-03-10" };

  async function insertRecord(input: {
    employeeId: string;
    workDate: string;
    status: string;
    scheduledMinutes: number;
    workedMinutes: number | null;
    lateMinutes: number | null;
    earlyDepartureMinutes: number | null;
    overtimeMinutes: number | null;
  }) {
    await db.insert(schema.attendanceDailyRecords).values({
      companyId: companyAId,
      employeeId: input.employeeId,
      workDate: input.workDate,
      status: input.status as (typeof schema.attendanceDailyRecords.$inferInsert)["status"],
      scheduledMinutes: input.scheduledMinutes,
      workedMinutes: input.workedMinutes,
      lateMinutes: input.lateMinutes,
      earlyDepartureMinutes: input.earlyDepartureMinutes,
      overtimeMinutes: input.overtimeMinutes,
    });
  }

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    reportSvc = await import("../attendance-report.service");
    organizationSvc = await import("@/domains/organization/service");
    employeeService = await import("@/domains/employee/service");
    ({ AuthorizationError } = await import("@/lib/errors"));

    const [companyA] = await db
      .insert(schema.companies)
      .values({ name: "Report Test Co A", code: `REPORT_TEST_A_${Date.now()}`, timezone: "UTC" })
      .returning();
    const [companyB] = await db
      .insert(schema.companies)
      .values({ name: "Report Test Co B", code: `REPORT_TEST_B_${Date.now()}`, timezone: "UTC" })
      .returning();
    companyAId = companyA!.id;
    companyBId = companyB!.id;

    const [adminUser] = await db
      .insert(schema.users)
      .values({ email: `report-admin-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Report Test Admin" })
      .returning();
    adminUserId = adminUser!.id;

    ctx = { requestId: "report-test", userId: adminUserId, userEmail: adminUser!.email, companyId: companyAId, role: "COMPANY_ADMIN", employeeId: null };
    ctxHrManager = { ...ctx, role: "HR_MANAGER", requestId: "report-test-hrm" };
    ctxManager = { ...ctx, role: "MANAGER", requestId: "report-test-mgr" };
    ctxEmployee = { ...ctx, role: "EMPLOYEE", requestId: "report-test-emp" };
    ctxCompanyB = { ...ctx, companyId: companyBId, requestId: "report-test-b" };

    const branchA1 = await organizationSvc.createBranch(ctx, { name: "A1", code: `RPT_A1_${Date.now()}` });
    const branchA2 = await organizationSvc.createBranch(ctx, { name: "A2", code: `RPT_A2_${Date.now()}` });
    branchA1Id = branchA1.id;
    branchA2Id = branchA2.id;

    const deptEng = await organizationSvc.createDepartment(ctx, { name: "Engineering", code: `RPT_ENG_${Date.now()}` });
    const deptSales = await organizationSvc.createDepartment(ctx, { name: "Sales", code: `RPT_SALES_${Date.now()}` });
    deptEngId = deptEng.id;
    deptSalesId = deptSales.id;

    const emp1 = await employeeService.createEmployee(ctx, {
      firstName: "Rita",
      lastName: `Report-${Date.now()}`,
      workEmail: `rpt-emp1-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branchA1Id,
      departmentId: deptEngId,
    });
    const emp2 = await employeeService.createEmployee(ctx, {
      firstName: "Sam",
      lastName: `Report-${Date.now()}`,
      workEmail: `rpt-emp2-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branchA2Id,
      departmentId: deptSalesId,
    });
    const emp3 = await employeeService.createEmployee(ctx, {
      firstName: "Tara",
      lastName: `Report-${Date.now()}`,
      workEmail: `rpt-emp3-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branchA2Id,
      departmentId: deptEngId,
    });
    emp1Id = emp1.id;
    emp2Id = emp2.id;
    emp3Id = emp3.id;

    // Company B fixture — proves cross-tenant rows never leak into Company A's report.
    const employeeB = await employeeService.createEmployee(ctxCompanyB, {
      firstName: "Bob",
      lastName: `ReportB-${Date.now()}`,
      workEmail: `rpt-empb-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
    });
    await db.insert(schema.attendanceDailyRecords).values({
      companyId: companyBId,
      employeeId: employeeB.id,
      workDate: "2027-03-01",
      status: "PRESENT",
      scheduledMinutes: 480,
      workedMinutes: 480,
      lateMinutes: 0,
      earlyDepartureMinutes: 0,
      overtimeMinutes: 0,
    });

    // --- Company A daily records (7 total, spanning the full range) ---
    await insertRecord({ employeeId: emp1Id, workDate: "2027-03-01", status: "PRESENT", scheduledMinutes: 540, workedMinutes: 540, lateMinutes: 0, earlyDepartureMinutes: 0, overtimeMinutes: 0 });
    await insertRecord({ employeeId: emp1Id, workDate: "2027-03-02", status: "LATE", scheduledMinutes: 540, workedMinutes: 520, lateMinutes: 20, earlyDepartureMinutes: 0, overtimeMinutes: 0 });
    await insertRecord({ employeeId: emp1Id, workDate: "2027-03-03", status: "ABSENT", scheduledMinutes: 540, workedMinutes: 0, lateMinutes: null, earlyDepartureMinutes: null, overtimeMinutes: 0 });
    await insertRecord({ employeeId: emp1Id, workDate: "2027-03-04", status: "INCOMPLETE", scheduledMinutes: 540, workedMinutes: null, lateMinutes: null, earlyDepartureMinutes: null, overtimeMinutes: null });
    await insertRecord({ employeeId: emp2Id, workDate: "2027-03-01", status: "PRESENT", scheduledMinutes: 480, workedMinutes: 480, lateMinutes: 0, earlyDepartureMinutes: 0, overtimeMinutes: 0 });
    await insertRecord({ employeeId: emp2Id, workDate: "2027-03-05", status: "HOLIDAY", scheduledMinutes: 0, workedMinutes: 0, lateMinutes: null, earlyDepartureMinutes: null, overtimeMinutes: 0 });
    await insertRecord({ employeeId: emp3Id, workDate: "2027-03-01", status: "WEEKLY_OFF", scheduledMinutes: 0, workedMinutes: 0, lateMinutes: null, earlyDepartureMinutes: null, overtimeMinutes: 0 });
  });

  afterAll(async () => {
    await db.delete(schema.companies).where(eq(schema.companies.id, companyAId));
    await db.delete(schema.companies).where(eq(schema.companies.id, companyBId));
    await db.delete(schema.users).where(eq(schema.users.id, adminUserId));
    await pool.end();
  });

  describe("getAttendanceReport", () => {
    it("returns every daily record in range for an unfiltered report", async () => {
      const result = await reportSvc.getAttendanceReport(ctx, FULL_RANGE, { page: 1, pageSize: 25 });
      expect(result.pagination.total).toBe(7);
      expect(result.rows).toHaveLength(7);
    });

    it("date filtering — only rows within the narrowed range", async () => {
      const result = await reportSvc.getAttendanceReport(ctx, { fromDate: "2027-03-01", toDate: "2027-03-01" }, { page: 1, pageSize: 25 });
      expect(result.pagination.total).toBe(3);
      expect(result.rows.every((r) => r.workDate === "2027-03-01")).toBe(true);
    });

    it("employee filter — only the selected employee's rows", async () => {
      const result = await reportSvc.getAttendanceReport(ctx, { ...FULL_RANGE, employeeId: emp1Id }, { page: 1, pageSize: 25 });
      expect(result.pagination.total).toBe(4);
      expect(result.rows.every((r) => r.employeeId === emp1Id)).toBe(true);
    });

    it("department filter — only employees in the selected department", async () => {
      const result = await reportSvc.getAttendanceReport(ctx, { ...FULL_RANGE, departmentId: deptEngId }, { page: 1, pageSize: 25 });
      expect(result.pagination.total).toBe(5); // emp1 (4) + emp3 (1)
      expect(result.rows.every((r) => [emp1Id, emp3Id].includes(r.employeeId))).toBe(true);
    });

    it("location filter — only employees at the selected branch", async () => {
      const result = await reportSvc.getAttendanceReport(ctx, { ...FULL_RANGE, locationId: branchA2Id }, { page: 1, pageSize: 25 });
      expect(result.pagination.total).toBe(3); // emp2 (2) + emp3 (1)
      expect(result.rows.every((r) => [emp2Id, emp3Id].includes(r.employeeId))).toBe(true);
    });

    it("status filter — only records with the selected status", async () => {
      const result = await reportSvc.getAttendanceReport(ctx, { ...FULL_RANGE, status: "PRESENT" }, { page: 1, pageSize: 25 });
      expect(result.pagination.total).toBe(2);
      expect(result.rows.every((r) => r.status === "PRESENT")).toBe(true);
    });

    it("search — matches employee last name and employee number, same convention as the dashboard", async () => {
      const byName = await reportSvc.getAttendanceReport(ctx, { ...FULL_RANGE, search: "Rita" }, { page: 1, pageSize: 25 });
      expect(byName.pagination.total).toBe(4);

      const empRow = await db.query.employees.findFirst({ where: eq(schema.employees.id, emp1Id) });
      const byNumber = await reportSvc.getAttendanceReport(ctx, { ...FULL_RANGE, search: empRow!.employeeNumber }, { page: 1, pageSize: 25 });
      expect(byNumber.pagination.total).toBe(4);
    });

    it("combined filters compose correctly (department + status)", async () => {
      const result = await reportSvc.getAttendanceReport(ctx, { ...FULL_RANGE, departmentId: deptEngId, status: "PRESENT" }, { page: 1, pageSize: 25 });
      expect(result.pagination.total).toBe(1);
      expect(result.rows[0]!.employeeId).toBe(emp1Id);
    });

    it("pagination — correct page/total/totalPages, and the summary reflects the whole filtered set, not just the current page", async () => {
      const page1 = await reportSvc.getAttendanceReport(ctx, FULL_RANGE, { page: 1, pageSize: 3 });
      expect(page1.rows).toHaveLength(3);
      expect(page1.pagination).toMatchObject({ page: 1, pageSize: 3, total: 7, totalPages: 3 });

      const page3 = await reportSvc.getAttendanceReport(ctx, FULL_RANGE, { page: 3, pageSize: 3 });
      expect(page3.rows).toHaveLength(1);

      // Same total row count across pages, no overlap: page1 ids + page2 ids + page3 ids = 7 distinct.
      const page2 = await reportSvc.getAttendanceReport(ctx, FULL_RANGE, { page: 2, pageSize: 3 });
      const allIds = new Set([...page1.rows, ...page2.rows, ...page3.rows].map((r) => `${r.employeeId}-${r.workDate}`));
      expect(allIds.size).toBe(7);

      // Summary from a 1-row page must still describe all 7 rows.
      expect(page1.summary.statusCounts).toMatchObject({ PRESENT: 2, LATE: 1, ABSENT: 1, INCOMPLETE: 1, HOLIDAY: 1, WEEKLY_OFF: 1, NO_SCHEDULE: 0, WEEKLY_OFF_WORKED: 0, HOLIDAY_WORKED: 0 });
    });

    it("summary sums minutes across the full filtered population, skipping (not zeroing) INCOMPLETE's null worked/overtime", async () => {
      const result = await reportSvc.getAttendanceReport(ctx, FULL_RANGE, { page: 1, pageSize: 1 });
      expect(result.summary.totalScheduledMinutes).toBe(540 + 540 + 540 + 540 + 480 + 0 + 0);
      expect(result.summary.totalWorkedMinutes).toBe(540 + 520 + 0 + 480 + 0); // emp1's INCOMPLETE (null) contributes nothing
      expect(result.summary.totalOvertimeMinutes).toBe(0);
    });

    it("null semantics — an INCOMPLETE row's worked/late/early/overtime minutes remain null, never coerced to 0", async () => {
      const result = await reportSvc.getAttendanceReport(ctx, { fromDate: "2027-03-04", toDate: "2027-03-04", employeeId: emp1Id }, { page: 1, pageSize: 25 });
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0]!;
      expect(row.status).toBe("INCOMPLETE");
      expect(row.workedMinutes).toBeNull();
      expect(row.lateMinutes).toBeNull();
      expect(row.earlyDepartureMinutes).toBeNull();
      expect(row.overtimeMinutes).toBeNull();
    });

    it("no fabricated absence — a date with no daily record produces no row, not a synthetic ABSENT", async () => {
      const result = await reportSvc.getAttendanceReport(ctx, { fromDate: "2027-03-09", toDate: "2027-03-09" }, { page: 1, pageSize: 25 });
      expect(result.rows).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it("tenant isolation — Company A's report never includes Company B's row, and Company B's report cannot see Company A's employee/department ids", async () => {
      const companyAResult = await reportSvc.getAttendanceReport(ctx, FULL_RANGE, { page: 1, pageSize: 25 });
      expect(companyAResult.pagination.total).toBe(7); // never 8

      const crossEmployee = await reportSvc.getAttendanceReport(ctxCompanyB, { ...FULL_RANGE, employeeId: emp1Id }, { page: 1, pageSize: 25 });
      expect(crossEmployee.pagination.total).toBe(0);

      const crossDepartment = await reportSvc.getAttendanceReport(ctxCompanyB, { ...FULL_RANGE, departmentId: deptEngId }, { page: 1, pageSize: 25 });
      expect(crossDepartment.pagination.total).toBe(0);

      const crossLocation = await reportSvc.getAttendanceReport(ctxCompanyB, { ...FULL_RANGE, locationId: branchA1Id }, { page: 1, pageSize: 25 });
      expect(crossLocation.pagination.total).toBe(0);
    });

    it("RBAC — HR_ADMIN and HR_MANAGER can run the report; MANAGER and EMPLOYEE are rejected", async () => {
      await expect(reportSvc.getAttendanceReport(ctx, FULL_RANGE, { page: 1, pageSize: 25 })).resolves.toBeDefined();
      await expect(reportSvc.getAttendanceReport(ctxHrManager, FULL_RANGE, { page: 1, pageSize: 25 })).resolves.toBeDefined();
      await expect(reportSvc.getAttendanceReport(ctxManager, FULL_RANGE, { page: 1, pageSize: 25 })).rejects.toThrow(AuthorizationError);
      await expect(reportSvc.getAttendanceReport(ctxEmployee, FULL_RANGE, { page: 1, pageSize: 25 })).rejects.toThrow(AuthorizationError);
    });
  });

  describe("exportAttendanceReportCsv", () => {
    it("RBAC — MANAGER and EMPLOYEE are rejected", async () => {
      await expect(reportSvc.exportAttendanceReportCsv(ctxManager, FULL_RANGE)).rejects.toThrow(AuthorizationError);
      await expect(reportSvc.exportAttendanceReportCsv(ctxEmployee, FULL_RANGE)).rejects.toThrow(AuthorizationError);
    });

    it("contains a header and exactly the filtered rows, matching the report's own filtering", async () => {
      const csv = await reportSvc.exportAttendanceReportCsv(ctx, { ...FULL_RANGE, departmentId: deptEngId, status: "PRESENT" });
      const lines = csv.split("\r\n");
      expect(lines[0]).toBe(
        "Employee Number,Employee Name,Department,Location,Date,Status,Scheduled Hours,Worked Hours,Late,Early Leave,Overtime",
      );
      expect(lines).toHaveLength(2); // header + exactly 1 matching row
      expect(lines[1]).toContain("2027-03-01");
      expect(lines[1]).toContain("Present");
      expect(lines[1]).toContain("09:00"); // 540 scheduled minutes
    });

    it("null minutes export as an empty field, never '0'", async () => {
      const csv = await reportSvc.exportAttendanceReportCsv(ctx, { fromDate: "2027-03-04", toDate: "2027-03-04", employeeId: emp1Id });
      const lines = csv.split("\r\n");
      const fields = lines[1]!.split(",");
      // Worked Hours, Late, Early Leave, Overtime are the last 4 columns and all null for this INCOMPLETE row.
      expect(fields.slice(-4)).toEqual(["", "", "", ""]);
    });

    it("escapes a department name containing a comma and a quote", async () => {
      const dept = await organizationSvc.createDepartment(ctx, { name: `Ops, "APAC"`, code: `RPT_OPS_${Date.now()}` });
      const emp = await employeeService.createEmployee(ctx, {
        firstName: "Cara",
        lastName: `Report-${Date.now()}`,
        workEmail: `rpt-emp-csv-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        departmentId: dept.id,
      });
      await insertRecord({ employeeId: emp.id, workDate: "2027-03-07", status: "PRESENT", scheduledMinutes: 480, workedMinutes: 480, lateMinutes: 0, earlyDepartureMinutes: 0, overtimeMinutes: 0 });

      const csv = await reportSvc.exportAttendanceReportCsv(ctx, { fromDate: "2027-03-07", toDate: "2027-03-07", employeeId: emp.id });
      expect(csv).toContain('"Ops, ""APAC"""');
    });

    it("neutralizes a formula-injection-risky department name in the export without altering the stored value", async () => {
      const dept = await organizationSvc.createDepartment(ctx, { name: "=2+2", code: `RPT_FORMULA_${Date.now()}` });
      const emp = await employeeService.createEmployee(ctx, {
        firstName: "Dana",
        lastName: `Report-${Date.now()}`,
        workEmail: `rpt-emp-formula-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        departmentId: dept.id,
      });
      await insertRecord({ employeeId: emp.id, workDate: "2027-03-08", status: "PRESENT", scheduledMinutes: 480, workedMinutes: 480, lateMinutes: 0, earlyDepartureMinutes: 0, overtimeMinutes: 0 });

      const csv = await reportSvc.exportAttendanceReportCsv(ctx, { fromDate: "2027-03-08", toDate: "2027-03-08", employeeId: emp.id });
      expect(csv).toContain("'=2+2");

      const stored = await db.query.departments.findFirst({ where: eq(schema.departments.id, dept.id) });
      expect(stored!.name).toBe("=2+2"); // the database value itself is never altered
    });
  });

  describe("assertExportRowLimit", () => {
    it("throws when the row count exceeds the configured maximum", () => {
      expect(() => reportSvc.assertExportRowLimit(50_001, 50_000)).toThrow(reportSvc.AttendanceReportExportTooLargeError);
    });

    it("does not throw at or below the configured maximum", () => {
      expect(() => reportSvc.assertExportRowLimit(50_000, 50_000)).not.toThrow();
      expect(() => reportSvc.assertExportRowLimit(1, 50_000)).not.toThrow();
    });
  });
});
