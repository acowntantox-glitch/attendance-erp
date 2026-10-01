import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";

const available = await isDatabaseAvailable();

/**
 * Batch 3.1: a manager's dashboard counts (F-02 follow-up), responses that do not reveal whether a resource
 * exists (F-24), and two integrity checks (dismissal FK behaviour, one login = one employee record).
 */
describe.skipIf(!available)("batch 3.1", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let employeeSvc: typeof import("../service");
  let workforceSvc: typeof import("@/domains/workforce/service");
  let attendanceSvc: typeof import("@/domains/attendance/service");
  let errorsMod: typeof import("../errors");
  let apiError: typeof import("@/lib/api/response").apiError;

  type Ctx = import("@/lib/auth/request-context").RequestContext;
  let companyAId: string;
  let companyBId: string;
  let adminUserId: string;
  let ctx: Ctx;
  let ctxB: Ctx;
  let scheduleId: string;
  let seq = 0;
  const createdUsers: string[] = [];

  async function newEmployee(label: string, o: { managerId?: string; companyCtx?: Ctx; status?: "PROBATION" | "ACTIVE"; joined?: string; userId?: string } = {}) {
    seq += 1;
    const companyCtx = o.companyCtx ?? ctx;
    const employee = await employeeSvc.createEmployee(companyCtx, {
      firstName: label,
      lastName: `E${seq}-${Date.now()}`,
      workEmail: `b31-${label.toLowerCase()}-${seq}-${Date.now()}@test.local`,
      dateOfJoining: o.joined ?? "2020-01-01",
      ...(o.managerId ? { managerId: o.managerId } : {}),
      ...(o.userId ? { userId: o.userId } : {}),
    });
    if (o.status === "PROBATION") await db.update(schema.employees).set({ employmentStatus: "PROBATION" }).where(eq(schema.employees.id, employee.id));
    return employee;
  }
  const managerCtx = (employeeId: string | null): Ctx => ({ ...ctx, role: "MANAGER", employeeId, requestId: `b31-mgr-${seq}` });

  /** What a client would receive for whatever this call throws (or the success marker). */
  async function respond(fn: () => Promise<unknown>) {
    try {
      await fn();
      return { status: 200, body: null as unknown };
    } catch (error) {
      const response = apiError(error, "rid-fixed");
      return { status: response.status, body: (await response.json()) as unknown };
    }
  }

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    employeeSvc = await import("../service");
    workforceSvc = await import("@/domains/workforce/service");
    attendanceSvc = await import("@/domains/attendance/service");
    errorsMod = await import("../errors");
    ({ apiError } = await import("@/lib/api/response"));

    const [a] = await db.insert(schema.companies).values({ name: "B31 Co A", code: `B31_A_${Date.now()}`, timezone: "UTC" }).returning();
    const [b] = await db.insert(schema.companies).values({ name: "B31 Co B", code: `B31_B_${Date.now()}`, timezone: "UTC" }).returning();
    companyAId = a!.id;
    companyBId = b!.id;
    const [admin] = await db.insert(schema.users).values({ email: `b31-admin-${Date.now()}@test.local`, passwordHash: "unused", fullName: "B31 Admin" }).returning();
    adminUserId = admin!.id;
    ctx = { requestId: "b31", userId: adminUserId, userEmail: admin!.email, companyId: companyAId, role: "COMPANY_ADMIN", employeeId: null };
    ctxB = { ...ctx, companyId: companyBId, requestId: "b31-b" };
    scheduleId = (await workforceSvc.createWorkSchedule(ctx, { name: `B31Day-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" })).id;
  });

  afterAll(async () => {
    await db.delete(schema.companies).where(eq(schema.companies.id, companyAId));
    await db.delete(schema.companies).where(eq(schema.companies.id, companyBId));
    for (const id of [adminUserId, ...createdUsers]) await db.delete(schema.users).where(eq(schema.users.id, id));
    await pool.end();
  });

  // ------------------------------------------------------------------------------------------------
  describe("manager dashboard counts respect the team scope", () => {
    let m1: { id: string };
    let m2: { id: string };
    const thisMonth = new Date().toISOString().slice(0, 8) + "01";

    beforeAll(async () => {
      m1 = await newEmployee("M1");
      m2 = await newEmployee("M2");
      // Team 1: two reports (one on probation, one who joined this month). Team 2: three reports.
      await newEmployee("T1a", { managerId: m1.id });
      await newEmployee("T1b", { managerId: m1.id, status: "PROBATION", joined: thisMonth });
      for (const label of ["T2a", "T2b", "T2c"]) await newEmployee(label, { managerId: m2.id });
      await newEmployee("Outsider");
      const assignments = (await employeeSvc.listEmployees(ctx, { page: 1, pageSize: 100 })).items;
      // Everyone gets a schedule; team-1 members also get a change starting in a week.
      for (const e of assignments) {
        await workforceSvc.assignEmployeeSchedule(ctx, e.id, { workScheduleId: scheduleId, effectiveFrom: "2020-01-01" });
      }
    });

    it("a manager sees their OWN team's count (the manager plus reports), not the company's", async () => {
      const counts = await employeeSvc.getEmployeeCounts(managerCtx(m1.id));
      expect(counts.totalEmployees).toBe(3); // M1, T1a, T1b
      expect(counts.activeEmployees).toBe(2);
      expect(counts.onProbation).toBe(1);
      expect(counts.newJoinersThisMonth).toBe(1);
    });

    it("a manager cannot see another team's count, directly or by subtraction", async () => {
      const c1 = await employeeSvc.getEmployeeCounts(managerCtx(m1.id));
      const c2 = await employeeSvc.getEmployeeCounts(managerCtx(m2.id));
      expect(c2.totalEmployees).toBe(4); // M2, T2a, T2b, T2c - nothing of team 1
      expect(c2.onProbation).toBe(0);
      expect(c2.newJoinersThisMonth).toBe(0);
      const company = await employeeSvc.getEmployeeCounts(ctx);
      expect(company.totalEmployees).toBeGreaterThan(c1.totalEmployees + c2.totalEmployees); // the outsider and others are not in either
    });

    it("an admin still sees the company-wide numbers", async () => {
      const company = await employeeSvc.getEmployeeCounts(ctx);
      const all = (await employeeSvc.listEmployees(ctx, { page: 1, pageSize: 100 })).total;
      expect(company.totalEmployees).toBe(all);
      expect(company.totalEmployees).toBeGreaterThanOrEqual(8); // 2 managers + 5 reports + the outsider
      expect(company.onProbation).toBeGreaterThanOrEqual(1);
    });

    it("two managers do not affect each other: changing one team leaves the other's dashboard unchanged", async () => {
      const before1 = await employeeSvc.getEmployeeCounts(managerCtx(m1.id));
      await newEmployee("T2d", { managerId: m2.id }); // team 2 grows
      const after1 = await employeeSvc.getEmployeeCounts(managerCtx(m1.id));
      const after2 = await employeeSvc.getEmployeeCounts(managerCtx(m2.id));
      expect(after1).toEqual(before1);
      expect(after2.totalEmployees).toBe(5);
    });

    it("the workforce dashboard (scheduled / off / holiday tiles) and upcoming changes follow the same scope, and it does not fail for a manager", async () => {
      const day = "2026-07-21";
      const summary1 = await workforceSvc.getWorkforceDashboardSummary(managerCtx(m1.id), day);
      expect(summary1.employeesScheduledToday).toBe(2); // M1 + T1a (T1b is on probation: not an ACTIVE employee)
      const summary2 = await workforceSvc.getWorkforceDashboardSummary(managerCtx(m2.id), day);
      expect(summary2.employeesScheduledToday).toBe(5);
      const company = await workforceSvc.getWorkforceDashboardSummary(ctx, day);
      expect(company.employeesScheduledToday).toBeGreaterThan(summary1.employeesScheduledToday + summary2.employeesScheduledToday);

      // A schedule change for a team-2 member next week is invisible to manager 1 and visible to manager 2.
      const t2 = (await employeeSvc.listEmployees(ctx, { page: 1, pageSize: 100, search: "T2a" })).items[0]!;
      await workforceSvc.assignEmployeeSchedule(ctx, t2.id, { workScheduleId: scheduleId, effectiveFrom: "2026-07-25" });
      const m1View = await workforceSvc.getWorkforceDashboardSummary(managerCtx(m1.id), day);
      const m2View = await workforceSvc.getWorkforceDashboardSummary(managerCtx(m2.id), day);
      expect(m1View.upcomingScheduleChanges.some((c) => c.employeeId === t2.id)).toBe(false);
      expect(m2View.upcomingScheduleChanges.some((c) => c.employeeId === t2.id)).toBe(true);
    });

    it("a manager with no linked employee sees zeros, never the company", async () => {
      const counts = await employeeSvc.getEmployeeCounts(managerCtx(null));
      expect(counts.totalEmployees).toBe(0);
      expect((await workforceSvc.getWorkforceDashboardSummary(managerCtx(null), "2026-07-21")).employeesScheduledToday).toBe(0);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe("F-24 a denial does not reveal whether the resource exists", () => {
    const RANDOM = "00000000-0000-4000-8000-000000000001"; // a well-formed id that exists nowhere
    let mgr: { id: string };
    let insideTeam: { id: string };
    let outsider: { id: string };
    let correctionId: string;

    beforeAll(async () => {
      mgr = await newEmployee("F24Mgr");
      insideTeam = await newEmployee("F24In", { managerId: mgr.id });
      outsider = await newEmployee("F24Out");
      await workforceSvc.assignEmployeeSchedule(ctx, outsider.id, { workScheduleId: scheduleId, effectiveFrom: "2020-01-01" });
      const correction = await attendanceSvc.requestCorrection(ctx, outsider.id, {
        workDate: "2026-07-20",
        fieldChanged: "CHECK_IN",
        correctedValue: new Date("2026-07-20T09:00:00Z"),
        reason: "f24",
      });
      correctionId = correction.id;
    });

    /** For each protected resource type: [label, call(id)]. */
    const probes: [string, (c: Ctx, id: string) => Promise<unknown>][] = [
      ["employee profile", (c, id) => employeeSvc.getEmployee(c, id)],
      ["employee history", (c, id) => employeeSvc.listEmployeeHistory(c, id)],
      ["employee documents", (c, id) => employeeSvc.listEmployeeDocuments(c, id)],
      ["attendance day", (c, id) => attendanceSvc.getAttendanceDay(c, id, "2026-07-20")],
      ["workforce day", (c, id) => workforceSvc.getWorkforceDayInfo(c, id, "2026-07-20")],
    ];

    it.each(probes)("DIFFERENT COMPANY: %s - another company's admin gets the same answer for an existing id as for a missing one", async (_label, call) => {
      const existingElsewhere = await respond(() => call(ctxB, outsider.id));
      const missing = await respond(() => call(ctxB, RANDOM));
      expect(existingElsewhere).toEqual(missing);
      expect(existingElsewhere.status).toBe(404);
      expect((existingElsewhere.body as { error: { code: string } }).error.code).toBe("NOT_FOUND");
      expect(JSON.stringify(existingElsewhere.body)).not.toContain("company"); // nothing hints at tenancy
    });

    it.each(probes.filter(([label]) => label !== "employee documents"))(
      "SAME COMPANY, TEAM SCOPE: %s - a manager gets the same answer for someone outside their team as for a missing id",
      async (_label, call) => {
        const m = managerCtx(mgr.id);
        const outOfTeam = await respond(() => call(m, outsider.id));
        const missing = await respond(() => call(m, RANDOM));
        expect(outOfTeam).toEqual(missing);
        expect(outOfTeam.status).toBe(404);
        // ...and a member of their own team is reachable (the denial is not a blanket refusal).
        expect((await respond(() => call(m, insideTeam.id))).status).toBe(200);
      },
    );

    it("SAME COMPANY, ROLE WITHOUT THE PERMISSION: a manager gets one uniform 403 for documents, existing or not", async () => {
      const m = managerCtx(mgr.id);
      const existing = await respond(() => employeeSvc.listEmployeeDocuments(m, insideTeam.id));
      const missing = await respond(() => employeeSvc.listEmployeeDocuments(m, RANDOM));
      expect(existing).toEqual(missing);
      expect(existing.status).toBe(403);
    });

    it("SAME COMPANY, EMPLOYEE ROLE: asking for another person's record is one uniform 403 whether or not they exist (permission is decided before any lookup)", async () => {
      const [meUser] = await db.insert(schema.users).values({ email: `b31-me-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Me" }).returning();
      createdUsers.push(meUser!.id);
      const me = await newEmployee("F24Me");
      await db.update(schema.employees).set({ userId: meUser!.id }).where(eq(schema.employees.id, me.id));
      const meCtx: Ctx = { ...ctx, role: "EMPLOYEE", userId: meUser!.id, employeeId: me.id };
      for (const [, call] of probes.filter(([label]) => ["employee profile", "employee history", "employee documents"].includes(label))) {
        const existing = await respond(() => call(meCtx, outsider.id));
        const missing = await respond(() => call(meCtx, RANDOM));
        expect(existing).toEqual(missing);
        expect(existing.status).toBe(403);
      }
      // Their own record still works.
      expect((await respond(() => employeeSvc.getEmployee(meCtx, me.id))).status).toBe(200);
    });

    it("CORRECTIONS: an employee asking for someone else's correction, another company, and a missing one all read the same", async () => {
      const me = await newEmployee("F24Me2");
      const meCtx: Ctx = { ...ctx, role: "EMPLOYEE", employeeId: me.id };
      const others = await respond(() => attendanceSvc.getCorrectionDetail(meCtx, correctionId));
      const missing = await respond(() => attendanceSvc.getCorrectionDetail(meCtx, RANDOM));
      const otherCompany = await respond(() => attendanceSvc.getCorrectionDetail(ctxB, correctionId));
      expect(others).toEqual(missing);
      expect(otherCompany).toEqual(missing);
      expect(missing.status).toBe(404);
    });

    it("NON-EXISTENT resources keep their 404 for authorized callers, and existing ones still succeed (legitimate behaviour unchanged)", async () => {
      expect((await respond(() => employeeSvc.getEmployee(ctx, RANDOM))).status).toBe(404);
      expect((await respond(() => attendanceSvc.getCorrectionDetail(ctx, RANDOM))).status).toBe(404);
      expect((await respond(() => employeeSvc.getEmployee(ctx, outsider.id))).status).toBe(200);
      expect((await respond(() => attendanceSvc.getCorrectionDetail(ctx, correctionId))).status).toBe(200);
    });

    it("DOCUMENT DOWNLOAD: another company's caller cannot tell a real document id from a made-up one", async () => {
      const doc = await (await import("../repository")).employeeDocumentRepository.create({
        companyId: companyAId,
        employeeId: outsider.id,
        documentType: "OTHER",
        title: "f24",
        storageKey: "test/f24",
        originalFilename: "f24.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
      });
      const real = await respond(() => employeeSvc.getEmployeeDocumentDownload(ctxB, outsider.id, doc.id));
      const fake = await respond(() => employeeSvc.getEmployeeDocumentDownload(ctxB, outsider.id, RANDOM));
      expect(real).toEqual(fake);
      expect(real.status).toBe(404);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe("dismissals: dismissed_by_user_id cannot be silently nulled", () => {
    it("deleting a user who dismissed an exception is refused (the FK behaves as RESTRICT) - the exception stays dismissed", async () => {
      const [dismisser] = await db.insert(schema.users).values({ email: `b31-dismisser-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Dismisser" }).returning();
      createdUsers.push(dismisser!.id);
      const employee = await newEmployee("Dism");
      const [row] = await db
        .insert(schema.attendanceExceptionDismissals)
        .values({ companyId: companyAId, employeeId: employee.id, workDate: "2026-07-20", exceptionType: "LATE", dismissedByUserId: dismisser!.id })
        .returning();

      await expect(db.delete(schema.users).where(eq(schema.users.id, dismisser!.id))).rejects.toThrow();

      const still = await db.query.attendanceExceptionDismissals.findFirst({ where: eq(schema.attendanceExceptionDismissals.id, row!.id) });
      expect(still?.dismissedByUserId).toBe(dismisser!.id); // never nulled, so the "is dismissed" join cannot flip to "not dismissed"
      expect(await db.query.users.findFirst({ where: eq(schema.users.id, dismisser!.id) })).toBeDefined();
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe("one login is the employee record of at most one person", () => {
    async function newUser(companyId: string) {
      const [user] = await db.insert(schema.users).values({ email: `b31-link-${Date.now()}-${Math.random()}@test.local`, passwordHash: "unused", fullName: "Link" }).returning();
      createdUsers.push(user!.id);
      await db.insert(schema.companyMemberships).values({ userId: user!.id, companyId, role: "EMPLOYEE" });
      return user!;
    }

    it("a login already linked to an employee cannot be linked to a second one - with an accurate error, not a mislabelled one", async () => {
      const user = await newUser(companyAId);
      await newEmployee("Linked", { userId: user.id });
      await expect(newEmployee("Linked2", { userId: user.id })).rejects.toBeInstanceOf(errorsMod.InvalidUserLinkError);
      expect(await db.query.employees.findMany({ where: eq(schema.employees.userId, user.id) })).toHaveLength(1);
    });

    it("concurrent attempts to link the same login: exactly one wins", async () => {
      const user = await newUser(companyAId);
      const results = await Promise.allSettled([newEmployee("RaceLink1", { userId: user.id }), newEmployee("RaceLink2", { userId: user.id }), newEmployee("RaceLink3", { userId: user.id })]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((x) => x.status === "rejected")) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(errorsMod.InvalidUserLinkError);
      expect(await db.query.employees.findMany({ where: eq(schema.employees.userId, user.id) })).toHaveLength(1);
    });

    it("a login that belongs to two companies resolves to the right employee per company, and the link is company-scoped at request time", async () => {
      const user = await newUser(companyAId);
      await db.insert(schema.companyMemberships).values({ userId: user.id, companyId: companyBId, role: "EMPLOYEE" });
      const inA = await newEmployee("TwoCoA", { userId: user.id });
      // The unique link means company B cannot ALSO give this login an employee record (a deliberate limit of
      // the current model - see the audit notes); request-time resolution is therefore unambiguous.
      await expect(newEmployee("TwoCoB", { userId: user.id, companyCtx: ctxB })).rejects.toBeInstanceOf(errorsMod.InvalidUserLinkError);
      const { employeeRepository } = await import("../repository");
      expect((await employeeRepository.findByUserId(companyAId, user.id))?.id).toBe(inA.id);
      expect(await employeeRepository.findByUserId(companyBId, user.id)).toBeUndefined();
    });

    it("a terminated employee keeps the link (history) but their login is deactivated, so it cannot be reused for someone else", async () => {
      const user = await newUser(companyAId);
      const employee = await newEmployee("Leaver", { userId: user.id });
      await employeeSvc.changeEmployeeStatus({ ...ctx, role: "HR_ADMIN" }, employee.id, "TERMINATED");
      const membership = await db.query.companyMemberships.findFirst({ where: and(eq(schema.companyMemberships.userId, user.id), eq(schema.companyMemberships.companyId, companyAId)) });
      expect(membership?.isActive).toBe(false);
      await expect(newEmployee("Replacement", { userId: user.id })).rejects.toThrow(); // inactive membership / already linked
    });
  });
});
