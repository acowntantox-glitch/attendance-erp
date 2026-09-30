import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../../tests/setup/db";

const available = await isDatabaseAvailable();

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describe.skipIf(!available)("scheduled attendance processing (Batch 13)", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let auto: typeof import("../attendance-auto-processing.service");
  let repo: typeof import("../attendance-processing.repository");
  let policySvc: typeof import("../../policy/attendance-policy.service");
  let periodSvc: typeof import("../../periods/attendance-period.service");
  let attendanceSvc: typeof import("../../service");
  let workforceSvc: typeof import("@/domains/workforce/service");
  let employeeService: typeof import("@/domains/employee/service");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;

  let companyAId: string;
  let companyBId: string;
  let adminUserId: string;
  let ctx: import("@/lib/auth/request-context").RequestContext;
  let ctxB: import("@/lib/auth/request-context").RequestContext;
  let scheduleId: string;

  let e1: string; // eligible, no record -> must be created
  let e2: string; // eligible, HAS an existing record -> must be untouched
  let e3: string; // archived
  let e4: string; // terminated (inactive)
  let e5: string; // joins in the future
  let eB: string; // company B employee, no record

  const D1 = "2026-04-09";
  const NOW_D1 = new Date("2026-04-10T12:00:00Z"); // with lag 180 / lookback 1 -> processes 2026-04-09
  const D2 = "2026-04-10";
  const NOW_D2 = new Date("2026-04-11T12:00:00Z");
  const D3 = "2026-04-11";
  const OPTS = { lagMinutes: 180, lookbackDays: 1 };

  async function createEmployee(label: string, dateOfJoining = "2020-01-01", companyCtx = ctx) {
    const employee = await employeeService.createEmployee(companyCtx, {
      firstName: "Auto",
      lastName: `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      workEmail: `auto-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`,
      dateOfJoining,
    });
    return employee.id;
  }

  async function assign(employeeId: string) {
    await workforceSvc.assignEmployeeSchedule(ctx, employeeId, { workScheduleId: scheduleId, effectiveFrom: "2026-01-01" });
  }

  async function recordsFor(companyId: string, workDate: string) {
    return db
      .select()
      .from(schema.attendanceDailyRecords)
      .where(and(eq(schema.attendanceDailyRecords.companyId, companyId), eq(schema.attendanceDailyRecords.workDate, workDate)));
  }

  async function runsFor(companyId: string) {
    return db.select().from(schema.attendanceProcessingRuns).where(eq(schema.attendanceProcessingRuns.companyId, companyId));
  }

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    auto = await import("../attendance-auto-processing.service");
    repo = await import("../attendance-processing.repository");
    policySvc = await import("../../policy/attendance-policy.service");
    periodSvc = await import("../../periods/attendance-period.service");
    attendanceSvc = await import("../../service");
    workforceSvc = await import("@/domains/workforce/service");
    employeeService = await import("@/domains/employee/service");
    ({ AuthorizationError } = await import("@/lib/errors"));

    const [companyA] = await db
      .insert(schema.companies)
      .values({ name: "Auto Proc Co A", code: `AUTO_A_${Date.now()}`, timezone: "UTC" })
      .returning();
    const [companyB] = await db
      .insert(schema.companies)
      .values({ name: "Auto Proc Co B", code: `AUTO_B_${Date.now()}`, timezone: "UTC" })
      .returning();
    companyAId = companyA!.id;
    companyBId = companyB!.id;

    const [admin] = await db
      .insert(schema.users)
      .values({ email: `auto-admin-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Auto Admin" })
      .returning();
    adminUserId = admin!.id;
    ctx = { requestId: "auto-test", userId: adminUserId, userEmail: admin!.email, companyId: companyAId, role: "COMPANY_ADMIN", employeeId: null };
    ctxB = { ...ctx, companyId: companyBId, requestId: "auto-test-b" };

    const schedule = await workforceSvc.createWorkSchedule(ctx, { name: `AutoDay-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
    scheduleId = schedule.id;

    e1 = await createEmployee("e1");
    e2 = await createEmployee("e2");
    e3 = await createEmployee("e3");
    e4 = await createEmployee("e4");
    e5 = await createEmployee("e5", "2030-01-01");
    for (const id of [e1, e2, e3, e4, e5]) await assign(id);
    await db.update(schema.employees).set({ isArchived: true }).where(eq(schema.employees.id, e3));
    await db.update(schema.employees).set({ employmentStatus: "TERMINATED" }).where(eq(schema.employees.id, e4));

    eB = await createEmployee("eB", "2020-01-01", ctxB);
  });

  afterAll(async () => {
    await db.delete(schema.companies).where(eq(schema.companies.id, companyAId));
    await db.delete(schema.companies).where(eq(schema.companies.id, companyBId));
    await db.delete(schema.users).where(eq(schema.users.id, adminUserId));
    await pool.end();
  });

  it("creates only the missing record, leaves an existing one byte-for-byte unchanged even after a policy change, and excludes ineligible employees", async () => {
    // A pre-existing record with figures the engine would NOT reproduce today.
    const [existing] = await db
      .insert(schema.attendanceDailyRecords)
      .values({
        companyId: companyAId,
        employeeId: e2,
        workDate: D1,
        status: "PRESENT",
        scheduledMinutes: 540,
        workedMinutes: 123,
        breakMinutes: 7,
        overtimeMinutes: 0,
        lateMinutes: 0,
        earlyDepartureMinutes: 0,
        sessionCount: 1,
        calculatedAt: new Date("2026-04-09T18:00:00Z"),
      })
      .returning();

    // A policy that WOULD reclassify that record (UNDER_HOURS, minimum 1000) if it were recalculated.
    await policySvc.updateAttendancePolicy(ctx, {
      defaultGracePeriodMinutes: 30,
      earlyDepartureGraceMinutes: 30,
      overtimeThresholdMinutes: 30,
      minimumWorkedMinutes: 1000,
    });

    const summary = await auto.runScheduledAttendanceProcessing({ ...OPTS, now: NOW_D1, companyIds: [companyAId] });

    const company = summary.companies.find((c) => c.companyId === companyAId)!;
    expect(company.error).toBeNull();
    expect(company.dates).toHaveLength(1);
    expect(company.dates[0]).toMatchObject({ workDate: D1, outcome: "PROCESSED", created: 1, skipped: 1, failed: 0 });

    const records = await recordsFor(companyAId, D1);
    expect(records.map((r) => r.employeeId).sort()).toEqual([e1, e2].sort());

    // e1 was materialized by the ordinary engine: a working day with no sessions is ABSENT.
    expect(records.find((r) => r.employeeId === e1)).toMatchObject({ status: "ABSENT", sessionCount: 0, workedMinutes: 0 });

    // e2: identical, column for column (including calculatedAt/updatedAt).
    expect(records.find((r) => r.employeeId === e2)).toEqual(existing);

    // Archived / terminated / not-yet-joined employees got nothing.
    for (const ineligible of [e3, e4, e5]) expect(records.some((r) => r.employeeId === ineligible)).toBe(false);
  });

  it("records the run and one system-actor audit entry (no fake user)", async () => {
    const runs = await runsFor(companyAId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ workDate: D1, trigger: "SCHEDULED", status: "COMPLETED", createdCount: 1, skippedCount: 1, failedCount: 0 });
    expect(runs[0]!.finishedAt).not.toBeNull();

    const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.companyId, companyAId));
    const processAudits = audits.filter((a) => a.action === "attendance.process.scheduled");
    expect(processAudits).toHaveLength(1);
    expect(processAudits[0]!.actorUserId).toBeNull();
    expect(processAudits[0]!.entityId).toBe(runs[0]!.id);
    expect(processAudits[0]!.metadata).toMatchObject({ actor: "system", workDate: D1, trigger: "SCHEDULED" });
  });

  it("is idempotent: a second run over the same date creates nothing and writes no new run row", async () => {
    const before = await recordsFor(companyAId, D1);
    const summary = await auto.runScheduledAttendanceProcessing({ ...OPTS, now: NOW_D1, companyIds: [companyAId] });

    expect(summary.created).toBe(0);
    expect(summary.companies[0]!.dates[0]).toMatchObject({ workDate: D1, outcome: "UP_TO_DATE", created: 0 });
    expect(await recordsFor(companyAId, D1)).toEqual(before);
    expect(await runsFor(companyAId)).toHaveLength(1);
  });

  it("never touches another company", async () => {
    expect(await recordsFor(companyBId, D1)).toHaveLength(0);
    expect(await runsFor(companyBId)).toHaveLength(0);
    // eB is eligible and has no record, but company B was never selected.
    expect(eB).toBeTruthy();
  });

  it("skips a closed period entirely, and processes it again once reopened", async () => {
    const e6 = await createEmployee("e6");
    await assign(e6);
    await periodSvc.closeAttendancePeriod(ctx, "2026-04");
    try {
      const summary = await auto.runScheduledAttendanceProcessing({ ...OPTS, now: NOW_D1, companyIds: [companyAId] });
      expect(summary.companies[0]!.dates[0]).toMatchObject({ workDate: D1, outcome: "SKIPPED_PERIOD_CLOSED", created: 0 });
      expect((await recordsFor(companyAId, D1)).some((r) => r.employeeId === e6)).toBe(false);
      expect(await runsFor(companyAId)).toHaveLength(1);
    } finally {
      await periodSvc.reopenAttendancePeriod(ctx, "2026-04");
    }

    const after = await auto.runScheduledAttendanceProcessing({ ...OPTS, now: NOW_D1, companyIds: [companyAId] });
    expect(after.companies[0]!.dates[0]).toMatchObject({ workDate: D1, outcome: "PROCESSED", created: 1 });
    expect((await recordsFor(companyAId, D1)).some((r) => r.employeeId === e6)).toBe(true);
  });

  it("isolates a per-employee failure: the others are processed, the run reports one failure, and a later run catches the failed employee up", async () => {
    const f1 = await createEmployee("f1");
    const f2 = await createEmployee("f2");
    const f3 = await createEmployee("f3");
    for (const id of [f1, f2, f3]) await assign(id);

    const failing: import("../attendance-auto-processing.service").ProcessingDeps = {
      materialize: async (companyId, employeeId, workDate) => {
        if (employeeId === f2) throw new Error("simulated failure for f2");
        return attendanceSvc.materializeMissingDailyRecord(companyId, employeeId, workDate);
      },
    };

    const summary = await auto.runScheduledAttendanceProcessing({ ...OPTS, now: NOW_D2, companyIds: [companyAId] }, failing);
    expect(summary.companies[0]!.dates[0]).toMatchObject({ workDate: D2, outcome: "PROCESSED", failed: 1 });

    const records = await recordsFor(companyAId, D2);
    const recorded = new Set(records.map((r) => r.employeeId));
    expect(recorded.has(f1)).toBe(true);
    expect(recorded.has(f3)).toBe(true);
    expect(recorded.has(f2)).toBe(false);

    const run = (await runsFor(companyAId)).find((r) => r.workDate === D2)!;
    expect(run).toMatchObject({ status: "COMPLETED", failedCount: 1 });
    expect(run.message).toContain(f2);

    // The next run (real materializer) picks up only the missing employee.
    const retry = await auto.runScheduledAttendanceProcessing({ ...OPTS, now: NOW_D2, companyIds: [companyAId] });
    expect(retry.companies[0]!.dates[0]).toMatchObject({ workDate: D2, outcome: "PROCESSED", created: 1, failed: 0 });
    expect((await recordsFor(companyAId, D2)).some((r) => r.employeeId === f2)).toBe(true);
  });

  it("holds a database lock per company/date: a concurrent attempt is refused; a crashed RUNNING row is recovered; parallel runs never duplicate", async () => {
    // 1. While another session holds the lock, this attempt is refused and writes nothing.
    await repo.attendanceProcessingRepository.withProcessingLock(companyAId, D3, async () => {
      const blocked = await auto.processCompanyWorkDate(companyAId, D3, "SCHEDULED");
      expect(blocked.outcome).toBe("SKIPPED_LOCKED");
      expect(await recordsFor(companyAId, D3)).toHaveLength(0);
    });

    // 2. A RUNNING row left by a crashed process does not block later runs (the partial unique index
    //    would otherwise reject the new RUNNING row): it is marked FAILED once the lock is held.
    await db.insert(schema.attendanceProcessingRuns).values({ companyId: companyAId, workDate: D3, trigger: "SCHEDULED", status: "RUNNING" });

    // 3. Two simultaneous runs: exactly one materializes, the other is refused or finds nothing missing.
    const [first, second] = await Promise.all([
      auto.processCompanyWorkDate(companyAId, D3, "SCHEDULED"),
      auto.processCompanyWorkDate(companyAId, D3, "SCHEDULED"),
    ]);
    const outcomes = [first.outcome, second.outcome];
    expect(outcomes.filter((o) => o === "PROCESSED")).toHaveLength(1);
    expect(outcomes.every((o) => ["PROCESSED", "UP_TO_DATE", "SKIPPED_LOCKED"].includes(o))).toBe(true);

    const records = await recordsFor(companyAId, D3);
    const employeeIds = records.map((r) => r.employeeId);
    expect(new Set(employeeIds).size).toBe(employeeIds.length);
    expect(first.created + second.created).toBe(records.length);

    const runsForDate = (await runsFor(companyAId)).filter((r) => r.workDate === D3);
    expect(runsForDate.filter((r) => r.status === "RUNNING")).toHaveLength(0);
    expect(runsForDate.filter((r) => r.status === "FAILED" && r.message?.startsWith("Abandoned"))).toHaveLength(1);
    expect(runsForDate.filter((r) => r.status === "COMPLETED")).toHaveLength(1);
  });

  it("only writes rows for the selected company, and processes another company independently", async () => {
    const summary = await auto.runScheduledAttendanceProcessing({ ...OPTS, now: NOW_D1, companyIds: [companyBId] });
    expect(summary.companies.map((c) => c.companyId)).toEqual([companyBId]);

    const bRecords = await recordsFor(companyBId, D1);
    expect(bRecords.map((r) => r.employeeId)).toEqual([eB]);
    expect(bRecords[0]!.companyId).toBe(companyBId);
    // Company A is unchanged by company B's run.
    expect((await recordsFor(companyAId, D1)).every((r) => r.companyId === companyAId)).toBe(true);
  });

  describe("historical employee eligibility (status as recorded at the end of the work date)", () => {
    let reinstated: string; // ACTIVE -> SUSPENDED (04-05) -> ACTIVE again (04-08); ACTIVE today
    let resignedLater: string; // ACTIVE until a resignation recorded 04-10 09:00Z; RESIGNED today

    // The test company is in UTC, so the end of a work date is the next UTC midnight.
    const endOf = (workDate: string) => new Date(new Date(`${workDate}T00:00:00Z`).getTime() + 86_400_000);
    const eligibleOn = (workDate: string) => repo.attendanceProcessingRepository.listEligibleEmployeeIdsAsOf(companyAId, workDate, endOf(workDate));

    async function history(employeeId: string, eventType: "STATUS_CHANGED" | "RESIGNED", before: string, after: string, at: string) {
      await db.insert(schema.employeeHistory).values({
        companyId: companyAId,
        employeeId,
        eventType,
        before: { employmentStatus: before },
        after: { employmentStatus: after },
        createdAt: new Date(at),
      });
    }

    beforeAll(async () => {
      reinstated = await createEmployee("reinstated");
      resignedLater = await createEmployee("resignedlater");
      await assign(reinstated);
      await assign(resignedLater);

      await history(reinstated, "STATUS_CHANGED", "ACTIVE", "SUSPENDED", "2026-04-05T10:00:00Z");
      await history(reinstated, "STATUS_CHANGED", "SUSPENDED", "ACTIVE", "2026-04-08T10:00:00Z");

      await db.update(schema.employees).set({ employmentStatus: "RESIGNED" }).where(eq(schema.employees.id, resignedLater));
      await history(resignedLater, "RESIGNED", "ACTIVE", "RESIGNED", "2026-04-10T09:00:00Z");
    });

    it("does not treat a since-reinstated employee as eligible for days they were suspended (no false absences), but does before and after", async () => {
      expect(await eligibleOn("2026-04-04")).toContain(reinstated); // active before the suspension
      expect(await eligibleOn("2026-04-05")).not.toContain(reinstated); // suspended (change recorded 04-05 10:00Z, before the day ended)
      expect(await eligibleOn("2026-04-06")).not.toContain(reinstated);
      expect(await eligibleOn("2026-04-07")).not.toContain(reinstated);
      expect(await eligibleOn("2026-04-08")).toContain(reinstated); // reinstated during 04-08
      expect(await eligibleOn("2026-04-09")).toContain(reinstated);
    });

    it("end to end: the job leaves a suspended day without a record instead of marking it ABSENT", async () => {
      const result = await auto.processCompanyWorkDate(companyAId, "2026-04-06", "SCHEDULED");
      expect(result.outcome).toBe("PROCESSED");
      const records = await recordsFor(companyAId, "2026-04-06");
      expect(records.some((r) => r.employeeId === reinstated)).toBe(false);
      expect(records.some((r) => r.employeeId === e1)).toBe(true);
    });

    it("materializes the ABSENT day of an employee who has since resigned, and stops at the day the resignation was recorded", async () => {
      expect(await eligibleOn("2026-04-09")).toContain(resignedLater);
      expect(await eligibleOn("2026-04-10")).not.toContain(resignedLater);

      const result = await auto.processCompanyWorkDate(companyAId, D1, "SCHEDULED");
      expect(result.outcome).toBe("PROCESSED");
      const record = (await recordsFor(companyAId, D1)).find((r) => r.employeeId === resignedLater);
      expect(record).toMatchObject({ status: "ABSENT", sessionCount: 0 });
    });

    it("employees with no status history are judged by their current status, and archived / not-yet-joined / terminated stay excluded", async () => {
      const ids = await eligibleOn(D1);
      expect(ids).toContain(e1);
      expect(ids).toContain(e2);
      for (const excluded of [e3, e4, e5]) expect(ids).not.toContain(excluded);
    });
  });

  describe("run history (permission-gated, company-scoped)", () => {
    it("lets HR roles list their own company's runs, newest first, paginated", async () => {
      const page1 = await auto.listAttendanceProcessingRuns({ ...ctx, role: "HR_ADMIN" }, { page: 1, pageSize: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBeGreaterThan(2);
      expect(page1.items.every((r) => r.companyId === companyAId)).toBe(true);
      expect(page1.items[0]!.startedAt.getTime()).toBeGreaterThanOrEqual(page1.items[1]!.startedAt.getTime());

      const hrManager = await auto.listAttendanceProcessingRuns({ ...ctx, role: "HR_MANAGER" });
      expect(hrManager.total).toBe(page1.total);
    });

    it("never returns another company's runs", async () => {
      const b = await auto.listAttendanceProcessingRuns(ctxB);
      expect(b.items.length).toBeGreaterThan(0);
      expect(b.items.every((r) => r.companyId === companyBId)).toBe(true);
    });

    it("clamps oversized page sizes", async () => {
      const page = await auto.listAttendanceProcessingRuns(ctx, { pageSize: 100_000 });
      expect(page.pageSize).toBe(auto.MAX_RUN_HISTORY_PAGE_SIZE);
    });

    it("rejects roles without attendance.process.view", async () => {
      await expect(auto.listAttendanceProcessingRuns({ ...ctx, role: "MANAGER" })).rejects.toThrow(AuthorizationError);
      await expect(auto.listAttendanceProcessingRuns({ ...ctx, role: "EMPLOYEE" })).rejects.toThrow(AuthorizationError);
    });
  });
});
