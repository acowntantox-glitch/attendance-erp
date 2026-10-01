import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";

const available = await isDatabaseAvailable();

// Several sequential real-Postgres round trips per test (employees, schedules, concurrent punches) - the same
// class of timing the other attendance integration suites already widen for.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/**
 * Production audit remediation, Batch 3: reporting-line scope for MANAGER (F-02/F-04), access ending with
 * employment (F-12), no reviewing your own attendance (F-18), audit context (F-10), and a concurrency matrix
 * over the Batch 1/2 day lock. Every scenario checks real database state.
 */
describe.skipIf(!available)("batch 3 - scope, access and integrity", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let svc: typeof import("../service");
  let errors: typeof import("../errors");
  let processing: typeof import("../processing/attendance-processing.service");
  let reportSvc: typeof import("../reports/attendance-report.service");
  let employeeSvc: typeof import("@/domains/employee/service");
  let workforceSvc: typeof import("@/domains/workforce/service");
  let orgSvc: typeof import("@/domains/organization/service");
  let session: typeof import("@/lib/auth/session");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;

  type Ctx = import("@/lib/auth/request-context").RequestContext;
  let companyAId: string;
  let companyBId: string;
  let adminUserId: string;
  let reviewerUserId: string;
  let ctx: Ctx; // COMPANY_ADMIN, company A
  let ctxB: Ctx; // COMPANY_ADMIN, company B
  let ctxReviewer: Ctx; // HR_ADMIN, company A
  let scheduleId: string;
  let scheduleBId: string;
  let seq = 0;
  const createdUsers: string[] = [];

  async function newEmployee(label: string, overrides: { managerId?: string; userId?: string; companyCtx?: Ctx; scheduleFor?: string } = {}) {
    seq += 1;
    const companyCtx = overrides.companyCtx ?? ctx;
    const employee = await employeeSvc.createEmployee(companyCtx, {
      firstName: label,
      lastName: `E${seq}-${Date.now()}`,
      workEmail: `b3-${label.toLowerCase()}-${seq}-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      ...(overrides.managerId ? { managerId: overrides.managerId } : {}),
    });
    await workforceSvc.assignEmployeeSchedule(companyCtx, employee.id, {
      workScheduleId: companyCtx === ctxB ? scheduleBId : scheduleId,
      effectiveFrom: "2020-01-01",
    });
    if (overrides.userId) await db.update(schema.employees).set({ userId: overrides.userId }).where(eq(schema.employees.id, employee.id));
    return employee;
  }

  const managerCtx = (employeeId: string | null): Ctx => ({ ...ctx, role: "MANAGER", employeeId, requestId: `b3-mgr-${seq}`, userId: adminUserId });
  const at = (iso: string) => vi.setSystemTime(new Date(iso));

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    svc = await import("../service");
    errors = await import("../errors");
    processing = await import("../processing/attendance-processing.service");
    reportSvc = await import("../reports/attendance-report.service");
    employeeSvc = await import("@/domains/employee/service");
    workforceSvc = await import("@/domains/workforce/service");
    orgSvc = await import("@/domains/organization/service");
    session = await import("@/lib/auth/session");
    ({ AuthorizationError } = await import("@/lib/errors"));

    const [a] = await db.insert(schema.companies).values({ name: "B3 Co A", code: `B3_A_${Date.now()}`, timezone: "UTC" }).returning();
    const [b] = await db.insert(schema.companies).values({ name: "B3 Co B", code: `B3_B_${Date.now()}`, timezone: "UTC" }).returning();
    companyAId = a!.id;
    companyBId = b!.id;

    const [admin] = await db.insert(schema.users).values({ email: `b3-admin-${Date.now()}@test.local`, passwordHash: "unused", fullName: "B3 Admin" }).returning();
    adminUserId = admin!.id;
    const [reviewer] = await db.insert(schema.users).values({ email: `b3-reviewer-${Date.now()}@test.local`, passwordHash: "unused", fullName: "B3 Reviewer" }).returning();
    reviewerUserId = reviewer!.id;
    await db.insert(schema.companyMemberships).values({ userId: reviewerUserId, companyId: companyAId, role: "HR_ADMIN" });

    ctx = { requestId: "b3", userId: adminUserId, userEmail: admin!.email, companyId: companyAId, role: "COMPANY_ADMIN", employeeId: null };
    ctxB = { ...ctx, companyId: companyBId, requestId: "b3-b" };
    ctxReviewer = { ...ctx, userId: reviewerUserId, role: "HR_ADMIN", requestId: "b3-rev" };

    scheduleId = (await workforceSvc.createWorkSchedule(ctx, { name: `B3Day-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" })).id;
    scheduleBId = (await workforceSvc.createWorkSchedule(ctxB, { name: `B3DayB-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" })).id;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await db.delete(schema.companies).where(eq(schema.companies.id, companyAId));
    await db.delete(schema.companies).where(eq(schema.companies.id, companyBId));
    for (const id of [adminUserId, reviewerUserId, ...createdUsers]) await db.delete(schema.users).where(eq(schema.users.id, id));
    await pool.end();
  });

  // ------------------------------------------------------------------------------------------------
  describe("F-02 reporting-line scope for MANAGER", () => {
    let mgr: { id: string };
    let direct: { id: string };
    let indirect: { id: string };
    let outsider: { id: string };

    beforeAll(async () => {
      mgr = await newEmployee("Mgr");
      direct = await newEmployee("Direct", { managerId: mgr.id });
      indirect = await newEmployee("Indirect", { managerId: direct.id });
      outsider = await newEmployee("Outsider");
    });

    it("the team is the manager plus direct and indirect reports - never the outsider, other managers' people or archived staff", async () => {
      const { employeeRepository } = await import("@/domains/employee/repository");
      const team = await employeeRepository.listTeamIds(companyAId, mgr.id);
      expect(team.sort()).toEqual([direct.id, indirect.id].sort());

      const archived = await newEmployee("Archived", { managerId: mgr.id });
      await db.update(schema.employees).set({ isArchived: true }).where(eq(schema.employees.id, archived.id));
      expect(await employeeRepository.listTeamIds(companyAId, mgr.id)).not.toContain(archived.id);
    });

    it("a management cycle in the data cannot hang the lookup", async () => {
      const { employeeRepository } = await import("@/domains/employee/repository");
      const a = await newEmployee("CycA");
      const b = await newEmployee("CycB", { managerId: a.id });
      await db.update(schema.employees).set({ managerId: b.id }).where(eq(schema.employees.id, a.id)); // a <-> b
      const team = await employeeRepository.listTeamIds(companyAId, a.id);
      expect(team).toEqual([b.id]);
    });

    it("employee directory, profile, history and org chart are limited to the manager's line", async () => {
      const m = managerCtx(mgr.id);
      const list = await employeeSvc.listEmployees(m, { page: 1, pageSize: 100 });
      expect(list.items.map((e) => e.id).sort()).toEqual([mgr.id, direct.id, indirect.id].sort());
      expect(list.total).toBe(3);

      await expect(employeeSvc.getEmployee(m, indirect.id)).resolves.toBeDefined();
      await expect(employeeSvc.getEmployee(m, outsider.id)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(employeeSvc.listEmployeeHistory(m, direct.id)).resolves.toBeDefined();
      await expect(employeeSvc.listEmployeeHistory(m, outsider.id)).rejects.toBeInstanceOf(AuthorizationError);

      expect((await employeeSvc.getOrgChartSubtree(m, null)).map((n) => n.id)).toEqual([mgr.id]);
      expect((await employeeSvc.getOrgChartSubtree(m, mgr.id)).map((n) => n.id)).toEqual([direct.id]);
      await expect(employeeSvc.getOrgChartSubtree(m, outsider.id)).rejects.toBeInstanceOf(AuthorizationError);

      // HR sees everyone (positive control): scope narrows MANAGER only.
      const all = await employeeSvc.listEmployees(ctx, { page: 1, pageSize: 100 });
      expect(all.items.some((e) => e.id === outsider.id)).toBe(true);
    });

    it("a manager with no linked employee record has an empty scope", async () => {
      const list = await employeeSvc.listEmployees(managerCtx(null), { page: 1, pageSize: 100 });
      expect(list.items).toHaveLength(0);
      await expect(employeeSvc.getEmployee(managerCtx(null), direct.id)).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("attendance reads, corrections and the correction detail follow the same scope", async () => {
      const m = managerCtx(mgr.id);
      at("2026-07-21T12:00:00Z");
      await expect(svc.getAttendanceDay(m, indirect.id, "2026-07-20")).resolves.toBeDefined();
      await expect(svc.getAttendanceDay(m, outsider.id, "2026-07-20")).rejects.toBeInstanceOf(AuthorizationError);
      await expect(svc.listAttendanceForEmployee(m, direct.id, "2026-07-01", "2026-07-20")).resolves.toBeDefined();
      await expect(svc.listAttendanceForEmployee(m, outsider.id, "2026-07-01", "2026-07-20")).rejects.toBeInstanceOf(AuthorizationError);
      await expect(svc.getCurrentSession(m, outsider.id)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(svc.listCorrectionsForEmployee(m, outsider.id)).rejects.toBeInstanceOf(AuthorizationError);

      const own = await svc.requestCorrection(m, direct.id, { workDate: "2026-07-20", fieldChanged: "CHECK_IN", correctedValue: new Date("2026-07-20T09:05:00Z"), reason: "team member" });
      expect(own.employeeId).toBe(direct.id);
      await expect(
        svc.requestCorrection(m, outsider.id, { workDate: "2026-07-20", fieldChanged: "CHECK_IN", correctedValue: new Date("2026-07-20T09:05:00Z"), reason: "not my team" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      expect(await db.query.attendanceCorrections.findMany({ where: eq(schema.attendanceCorrections.employeeId, outsider.id) })).toHaveLength(0);

      // A correction on someone else's employee, filed by HR, is not readable by this manager.
      const hrFiled = await svc.requestCorrection(ctx, outsider.id, { workDate: "2026-07-20", fieldChanged: "CHECK_IN", correctedValue: new Date("2026-07-20T09:10:00Z"), reason: "hr" });
      await expect(svc.getCorrectionDetail(m, hrFiled.id)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(svc.getCorrectionDetail(m, own.id)).resolves.toBeDefined();
    });

    it("workforce per-employee reads (assignments, weekly-off override, day info) follow the scope", async () => {
      const m = managerCtx(mgr.id);
      await expect(workforceSvc.listEmployeeScheduleAssignments(m, direct.id)).resolves.toBeDefined();
      await expect(workforceSvc.listEmployeeScheduleAssignments(m, outsider.id)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(workforceSvc.getEmployeeWeeklyOffOverride(m, outsider.id)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(workforceSvc.getWorkforceDayInfo(m, direct.id, "2026-07-20")).resolves.toBeDefined();
      await expect(workforceSvc.getWorkforceDayInfo(m, outsider.id, "2026-07-20")).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("TENANT ISOLATION: another company's manager and admin reach none of this company's employees", async () => {
      const bEmployee = await newEmployee("BEmp", { companyCtx: ctxB });
      const bManager = await newEmployee("BMgr", { companyCtx: ctxB });
      await db.update(schema.employees).set({ managerId: bManager.id }).where(eq(schema.employees.id, bEmployee.id));
      const mB: Ctx = { ...ctxB, role: "MANAGER", employeeId: bManager.id };

      await expect(employeeSvc.getEmployee(mB, direct.id)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(svc.getAttendanceDay(mB, direct.id, "2026-07-20")).rejects.toBeInstanceOf(AuthorizationError);
      await expect(svc.getAttendanceDay(ctxB, direct.id, "2026-07-20")).rejects.toBeInstanceOf(AuthorizationError);
      expect((await employeeSvc.listEmployees(mB, { page: 1, pageSize: 100 })).items.map((e) => e.id).sort()).toEqual([bManager.id, bEmployee.id].sort());
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe("F-04 what a manager may edit", () => {
    it("a manager can change placement (department / designation / location) on their team, and re-submit the unchanged record", async () => {
      const mgr = await newEmployee("EditMgr");
      const report = await newEmployee("EditRep", { managerId: mgr.id });
      const dept = await orgSvc.createDepartment(ctx, { name: `B3Dept-${Date.now()}`, code: `B3D${Date.now()}`.slice(0, 20) });
      const m = managerCtx(mgr.id);

      const updated = await employeeSvc.updateEmployee(m, report.id, { departmentId: dept.id });
      expect(updated.departmentId).toBe(dept.id);
      // The edit form posts the whole record: unchanged values (even for fields a manager may not change) are fine.
      await expect(employeeSvc.updateEmployee(m, report.id, { departmentId: dept.id, firstName: report.firstName, workEmail: report.workEmail, phone: null })).resolves.toBeDefined();
    });

    it("a manager cannot change other fields (email, joining date, reporting manager, personal data), their own record, or anyone outside their team", async () => {
      const mgr = await newEmployee("EditMgr2");
      const report = await newEmployee("EditRep2", { managerId: mgr.id });
      const outsider = await newEmployee("EditOut");
      const m = managerCtx(mgr.id);

      for (const change of [{ workEmail: "hijack@test.local" }, { dateOfJoining: "2019-01-01" }, { managerId: outsider.id }, { phone: "+100000" }, { firstName: "Changed" }, { employmentType: "CONTRACT" as const }]) {
        await expect(employeeSvc.updateEmployee(m, report.id, change)).rejects.toBeInstanceOf(AuthorizationError);
      }
      await expect(employeeSvc.updateEmployee(m, mgr.id, { departmentId: null })).rejects.toBeInstanceOf(AuthorizationError); // own record
      await expect(employeeSvc.updateEmployee(m, outsider.id, { departmentId: null })).rejects.toBeInstanceOf(AuthorizationError); // not on the team

      const unchanged = await db.query.employees.findFirst({ where: eq(schema.employees.id, report.id) });
      expect(unchanged?.workEmail).toBe(report.workEmail);
      expect(unchanged?.managerId).toBe(mgr.id);

      // Positive control: HR is unaffected.
      await expect(employeeSvc.updateEmployee(ctx, report.id, { phone: "+100000" })).resolves.toBeDefined();
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe("F-12 leaving the company ends access", () => {
    async function employeeWithLogin(role: "EMPLOYEE" | "MANAGER" | "COMPANY_ADMIN" | "HR_ADMIN") {
      const [user] = await db.insert(schema.users).values({ email: `b3-login-${Date.now()}-${Math.random()}@test.local`, passwordHash: "unused", fullName: "Login" }).returning();
      createdUsers.push(user!.id);
      const [membership] = await db.insert(schema.companyMemberships).values({ userId: user!.id, companyId: companyAId, role }).returning();
      const employee = await newEmployee("Login", { userId: user!.id });
      const { token } = await session.createSession(user!.id, companyAId);
      return { user: user!, membership: membership!, employee, token };
    }
    const membershipOf = (id: string) => db.query.companyMemberships.findFirst({ where: eq(schema.companyMemberships.id, id) });

    it("TERMINATED and RESIGNED deactivate this company's login and revoke its sessions in the same operation, with an audit entry", async () => {
      for (const status of ["TERMINATED", "RESIGNED"] as const) {
        const { user, membership, employee, token } = await employeeWithLogin("EMPLOYEE");
        expect(await session.validateSessionToken(token)).not.toBeNull();

        await employeeSvc.changeEmployeeStatus(ctxReviewer, employee.id, status);

        expect((await membershipOf(membership.id))?.isActive).toBe(false);
        expect(await session.validateSessionToken(token)).toBeNull();
        const audits = await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.entityId, user.id) });
        expect(audits.some((l) => l.action === "user.deactivated" && (l.metadata as { reason?: string })?.reason === `employee_status:${status}`)).toBe(true);
      }
    });

    it("other statuses leave the login alone, and reinstating does NOT silently re-enable it", async () => {
      const { membership, employee, token } = await employeeWithLogin("EMPLOYEE");
      await employeeSvc.changeEmployeeStatus(ctxReviewer, employee.id, "SUSPENDED");
      expect((await membershipOf(membership.id))?.isActive).toBe(true);
      expect(await session.validateSessionToken(token)).not.toBeNull();

      await employeeSvc.changeEmployeeStatus(ctxReviewer, employee.id, "TERMINATED");
      await employeeSvc.changeEmployeeStatus(ctxReviewer, employee.id, "ACTIVE");
      expect((await membershipOf(membership.id))?.isActive).toBe(false); // explicit user-management action required
    });

    it("only THIS company's access ends: the same user's membership in another company is untouched", async () => {
      const { user, employee } = await employeeWithLogin("EMPLOYEE");
      const [otherMembership] = await db.insert(schema.companyMemberships).values({ userId: user.id, companyId: companyBId, role: "EMPLOYEE" }).returning();
      const { token: otherToken } = await session.createSession(user.id, companyBId);

      await employeeSvc.changeEmployeeStatus(ctxReviewer, employee.id, "TERMINATED");
      expect((await membershipOf(otherMembership!.id))?.isActive).toBe(true);
      expect(await session.validateSessionToken(otherToken)).not.toBeNull();
    });

    it("the user-management hierarchy still applies: HR cannot lock out a company admin by terminating them, and nobody revokes themself", async () => {
      const admin = await employeeWithLogin("COMPANY_ADMIN");
      await employeeSvc.changeEmployeeStatus(ctxReviewer, admin.employee.id, "TERMINATED"); // HR_ADMIN actor < COMPANY_ADMIN target
      expect((await membershipOf(admin.membership.id))?.isActive).toBe(true);
      const audit = await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.entityId, admin.employee.id) });
      expect(audit.some((l) => l.action === "employee.status_change" && (l.metadata as { loginAccessRevoked?: boolean })?.loginAccessRevoked === false)).toBe(true);

      const self = await employeeWithLogin("HR_ADMIN");
      const selfCtx: Ctx = { ...ctx, userId: self.user.id, role: "HR_ADMIN", employeeId: self.employee.id };
      await employeeSvc.changeEmployeeStatus(selfCtx, self.employee.id, "RESIGNED");
      expect((await membershipOf(self.membership.id))?.isActive).toBe(true);
    });

    it("a failed status change leaves the login untouched (one transaction)", async () => {
      const { membership, employee, token } = await employeeWithLogin("EMPLOYEE");
      const { employeeHistoryRepository } = await import("@/domains/employee/repository");
      vi.spyOn(employeeHistoryRepository, "create").mockRejectedValueOnce(new Error("simulated history failure"));
      await expect(employeeSvc.changeEmployeeStatus(ctxReviewer, employee.id, "TERMINATED")).rejects.toThrow("simulated history failure");
      expect((await membershipOf(membership.id))?.isActive).toBe(true);
      expect(await session.validateSessionToken(token)).not.toBeNull();
      expect((await db.query.employees.findFirst({ where: eq(schema.employees.id, employee.id) }))?.employmentStatus).toBe("ACTIVE");
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe("F-18 reviewing a correction to your own attendance", () => {
    it("a reviewer cannot approve or reject a correction about THEIR OWN day, even when someone else filed it", async () => {
      const [reviewerUser] = await db.insert(schema.users).values({ email: `b3-subject-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Subject Reviewer" }).returning();
      createdUsers.push(reviewerUser!.id);
      await db.insert(schema.companyMemberships).values({ userId: reviewerUser!.id, companyId: companyAId, role: "HR_ADMIN" });
      const subject = await newEmployee("Subject", { userId: reviewerUser!.id });
      const subjectCtx: Ctx = { ...ctx, userId: reviewerUser!.id, role: "HR_ADMIN", employeeId: subject.id, requestId: "b3-subject" };

      at("2026-07-21T12:00:00Z");
      const filedByOther = await svc.requestCorrection(ctx, subject.id, { workDate: "2026-07-20", fieldChanged: "CHECK_IN", correctedValue: new Date("2026-07-20T09:00:00Z"), reason: "filed by a colleague" });

      await expect(svc.approveCorrection(subjectCtx, filedByOther.id)).rejects.toBeInstanceOf(errors.SelfApprovalNotAllowedError);
      await expect(svc.rejectCorrection(subjectCtx, filedByOther.id)).rejects.toBeInstanceOf(errors.SelfApprovalNotAllowedError);
      expect((await db.query.attendanceCorrections.findFirst({ where: eq(schema.attendanceCorrections.id, filedByOther.id) }))?.status).toBe("PENDING");

      // Another eligible reviewer can.
      expect((await svc.approveCorrection(ctxReviewer, filedByOther.id)).status).toBe("APPROVED");
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe("F-10 audit context", () => {
    it("a recalculation records what the day looked like before, and an approval that closes a stranded session says so", async () => {
      const e = await newEmployee("AuditE");
      at("2026-07-21T09:00:00Z");
      await svc.checkIn(ctx, e.id);
      at("2026-07-21T10:00:00Z");
      const first = await svc.recalculateDailyRecord(ctx, e.id, "2026-07-21");
      at("2026-07-21T11:00:00Z");
      const second = await svc.recalculateDailyRecord(ctx, e.id, "2026-07-21");
      const recalcs = (await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.entityId, second.id) })).filter((l) => l.action === "attendance.recalculate");
      expect(recalcs.some((l) => (l.oldData as { id?: string } | null)?.id === first.id)).toBe(true);

      at("2026-07-21T20:00:00Z");
      const correction = await svc.requestCorrection(ctx, e.id, { workDate: "2026-07-21", fieldChanged: "CHECK_OUT", correctedValue: new Date("2026-07-21T18:00:00Z"), reason: "forgot" });
      await svc.approveCorrection(ctxReviewer, correction.id, { reviewNote: "confirmed" });
      const [open] = await db.query.attendanceOpenSessions.findMany({ where: eq(schema.attendanceOpenSessions.employeeId, e.id) });
      const approval = (await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.entityId, correction.id) })).find((l) => l.action === "attendance.correction.approve")!;
      expect(approval.actorUserId).toBe(reviewerUserId);
      expect(approval.companyId).toBe(companyAId);
      expect(approval.metadata).toMatchObject({ closedSessionId: open!.id, reviewNote: "confirmed", field: "CHECK_OUT" });
    });

    it("an attendance report export is audited with who, the filters and the row count", async () => {
      const csv = await reportSvc.exportAttendanceReportCsv(ctxReviewer, { fromDate: "2026-07-01", toDate: "2026-07-31" });
      expect(csv.split("\r\n")[0]).toContain("Employee Number");
      const logs = (await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.companyId, companyAId) })).filter((l) => l.action === "attendance.report.export");
      const mine = logs.find((l) => l.actorUserId === reviewerUserId);
      expect(mine?.metadata).toMatchObject({ filters: { fromDate: "2026-07-01", toDate: "2026-07-31" }, rowCount: expect.any(Number) });
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe("concurrency matrix over the shared day lock", () => {
    const eventsOf = (id: string) => db.query.attendanceEvents.findMany({ where: eq(schema.attendanceEvents.employeeId, id) });
    const sessionsOf = (id: string) => db.query.attendanceOpenSessions.findMany({ where: eq(schema.attendanceOpenSessions.employeeId, id) });
    const recordOf = (id: string, d: string) =>
      db.query.attendanceDailyRecords.findFirst({ where: and(eq(schema.attendanceDailyRecords.employeeId, id), eq(schema.attendanceDailyRecords.workDate, d)) });

    it("check-in racing check-out never leaves two open sessions or an inconsistent record", async () => {
      const e = await newEmployee("RaceInOut");
      const D = "2026-07-22";
      at(`${D}T09:00:00Z`);
      await svc.checkIn(ctx, e.id);
      at(`${D}T18:00:00Z`);
      const results = await Promise.allSettled([svc.checkOut(ctx, e.id), svc.checkIn(ctx, e.id)]);
      for (const r of results.filter((x) => x.status === "rejected")) {
        expect([errors.AlreadyCheckedInError, errors.NoOpenSessionError, errors.AttendanceChangedConcurrentlyError].some((E) => (r as PromiseRejectedResult).reason instanceof E)).toBe(true);
      }
      const sessions = await sessionsOf(e.id);
      expect(sessions.filter((s) => s.status === "OPEN").length).toBeLessThanOrEqual(1);
      expect((await eventsOf(e.id)).filter((x) => x.eventType === "CHECK_OUT")).toHaveLength(1);
      const record = await recordOf(e.id, D);
      expect(record?.sessionCount).toBe(sessions.filter((s) => s.workDate === D).length);
    });

    it("two simultaneous break starts / break ends: exactly one of each is recorded", async () => {
      const e = await newEmployee("RaceBreak");
      const D = "2026-07-23";
      at(`${D}T09:00:00Z`);
      await svc.checkIn(ctx, e.id);
      at(`${D}T13:00:00Z`);
      const starts = await Promise.allSettled([svc.startBreak(ctx, e.id), svc.startBreak(ctx, e.id)]);
      expect(starts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(((starts.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toBeInstanceOf(errors.OpenBreakExistsError);

      at(`${D}T13:30:00Z`);
      const ends = await Promise.allSettled([svc.endBreak(ctx, e.id), svc.endBreak(ctx, e.id)]);
      expect(ends.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(((ends.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toBeInstanceOf(errors.NoOpenBreakError);

      const types = (await eventsOf(e.id)).map((x) => x.eventType);
      expect(types.filter((t) => t === "BREAK_START")).toHaveLength(1);
      expect(types.filter((t) => t === "BREAK_END")).toHaveLength(1);
    });

    it("a recalculation racing the check-out ends with the correct, consistent record", async () => {
      const e = await newEmployee("RaceRecalc");
      const D = "2026-07-24";
      at(`${D}T09:00:00Z`);
      await svc.checkIn(ctx, e.id);
      at(`${D}T18:00:00Z`);
      const results = await Promise.all([svc.recalculateDailyRecord(ctx, e.id, D), svc.checkOut(ctx, e.id)]);
      expect(results).toHaveLength(2);
      const record = await recordOf(e.id, D);
      expect(record).toMatchObject({ status: "PRESENT", sessionCount: 1, workedMinutes: 540 });
    });

    it("Process Day racing a check-in never leaves a record that contradicts the session", async () => {
      const e = await newEmployee("RaceProcess");
      const D = "2026-07-25";
      at(`${D}T09:00:00Z`);
      const results = await Promise.all([processing.processEmployeeAttendanceDay(ctx, { employeeId: e.id, workDate: D }), svc.checkIn(ctx, e.id)]);
      expect(results).toHaveLength(2);
      const record = await recordOf(e.id, D);
      expect(record?.sessionCount).toBe(1);
      expect(record?.status).toBe("INCOMPLETE");
      expect(await sessionsOf(e.id)).toHaveLength(1);
    });

    it("different employees are independent: simultaneous punches all succeed, one session each, no cross-talk", async () => {
      const people = await Promise.all(Array.from({ length: 6 }, (_, i) => newEmployee(`Indep${i}`)));
      const D = "2026-07-27";
      at(`${D}T09:00:00Z`);
      const results = await Promise.allSettled(people.map((p) => svc.checkIn(ctx, p.id)));
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      for (const p of people) {
        const sessions = await sessionsOf(p.id);
        expect(sessions).toHaveLength(1);
        expect(sessions[0]!.employeeId).toBe(p.id);
      }
      at(`${D}T18:00:00Z`);
      const outs = await Promise.allSettled(people.map((p) => svc.checkOut(ctx, p.id)));
      expect(outs.every((r) => r.status === "fulfilled")).toBe(true);
    });

    it("different companies under load: each company's punches succeed and a cross-company attempt is refused without affecting anyone", async () => {
      const a = await newEmployee("CoA");
      const b = await newEmployee("CoB", { companyCtx: ctxB });
      const D = "2026-07-28";
      at(`${D}T09:00:00Z`);
      const [okA, okB, crossAtoB, crossBtoA] = await Promise.allSettled([svc.checkIn(ctx, a.id), svc.checkIn(ctxB, b.id), svc.checkIn(ctx, b.id), svc.checkIn(ctxB, a.id)]);
      expect(okA.status).toBe("fulfilled");
      expect(okB.status).toBe("fulfilled");
      expect((crossAtoB as PromiseRejectedResult).reason).toBeInstanceOf(AuthorizationError);
      expect((crossBtoA as PromiseRejectedResult).reason).toBeInstanceOf(AuthorizationError);
      expect(await sessionsOf(a.id)).toHaveLength(1);
      expect(await sessionsOf(b.id)).toHaveLength(1);
      expect((await sessionsOf(a.id))[0]!.companyId).toBe(companyAId);
      expect((await sessionsOf(b.id))[0]!.companyId).toBe(companyBId);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe("F-23 weekday in far-east timezones", () => {
    it("a weekly off is judged on the employee's LOCAL calendar day even in UTC+14 (12:00 UTC is already the next day there)", async () => {
      const [branch] = await db.insert(schema.branches).values({ companyId: companyAId, name: "Kiritimati", code: `B3_KIR_${Date.now()}`, timezone: "Pacific/Kiritimati" }).returning();
      const e = await newEmployee("Kiri");
      await db.update(schema.employees).set({ locationId: branch!.id }).where(eq(schema.employees.id, e.id));
      // Saturday (6) is the weekly off; 2026-07-18 is a Saturday.
      await workforceSvc.setEmployeeWeeklyOffOverride(ctx, e.id, { offDays: [6], effectiveFrom: "2026-01-01" });

      expect((await workforceSvc.getWorkforceDayInfo(ctx, e.id, "2026-07-18")).isWeeklyOff).toBe(true); // Saturday
      expect((await workforceSvc.getWorkforceDayInfo(ctx, e.id, "2026-07-19")).isWeeklyOff).toBe(false); // Sunday
      expect((await workforceSvc.getWorkforceDayInfo(ctx, e.id, "2026-07-17")).isWeeklyOff).toBe(false); // Friday
    });
  });
});
