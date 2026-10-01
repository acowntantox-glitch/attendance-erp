import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../../tests/setup/db";

const available = await isDatabaseAvailable();

vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

describe.skipIf(!available)("attendance policy (Batch 12)", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let policySvc: typeof import("../attendance-policy.service");
  let policyRepo: typeof import("../attendance-policy.repository");
  let attendanceSvc: typeof import("../../service");
  let workforceSvc: typeof import("@/domains/workforce/service");
  let employeeService: typeof import("@/domains/employee/service");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;
  let ValidationError: typeof import("@/lib/errors").ValidationError;

  let companyAId: string;
  let companyBId: string;
  let adminUserId: string;
  let reviewerUserId: string;
  let ctx: import("@/lib/auth/request-context").RequestContext;
  let ctxB: import("@/lib/auth/request-context").RequestContext;
  let ctxHrManager: import("@/lib/auth/request-context").RequestContext;
  let ctxManager: import("@/lib/auth/request-context").RequestContext;
  let ctxReviewer: import("@/lib/auth/request-context").RequestContext;
  let employeeId: string; // 09:00-18:00 schedule, NO shift

  const VALID = { defaultGracePeriodMinutes: 10, earlyDepartureGraceMinutes: 5, overtimeThresholdMinutes: 15, minimumWorkedMinutes: 420 };

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    policySvc = await import("../attendance-policy.service");
    policyRepo = await import("../attendance-policy.repository");
    attendanceSvc = await import("../../service");
    workforceSvc = await import("@/domains/workforce/service");
    employeeService = await import("@/domains/employee/service");
    ({ AuthorizationError, ValidationError } = await import("@/lib/errors"));

    const [companyA] = await db
      .insert(schema.companies)
      .values({ name: "Policy Test Co A", code: `POL_TEST_A_${Date.now()}`, timezone: "UTC" })
      .returning();
    const [companyB] = await db
      .insert(schema.companies)
      .values({ name: "Policy Test Co B", code: `POL_TEST_B_${Date.now()}`, timezone: "UTC" })
      .returning();
    companyAId = companyA!.id;
    companyBId = companyB!.id;
    const [branch] = await db.insert(schema.branches).values({ companyId: companyAId, name: "HQ", code: "POL_HQ", timezone: "UTC" }).returning();

    const [admin] = await db
      .insert(schema.users)
      .values({ email: `pol-admin-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Policy Admin" })
      .returning();
    adminUserId = admin!.id;
    const [reviewer] = await db
      .insert(schema.users)
      .values({ email: `pol-reviewer-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Policy Reviewer" })
      .returning();
    reviewerUserId = reviewer!.id;
    await db.insert(schema.companyMemberships).values({ userId: reviewerUserId, companyId: companyAId, role: "HR_ADMIN" });

    ctx = { requestId: "pol-test", userId: adminUserId, userEmail: admin!.email, companyId: companyAId, role: "COMPANY_ADMIN", employeeId: null };
    ctxB = { ...ctx, companyId: companyBId, requestId: "pol-test-b" };
    ctxHrManager = { ...ctx, role: "HR_MANAGER", requestId: "pol-test-hrm" };
    ctxManager = { ...ctx, role: "MANAGER", requestId: "pol-test-mgr" };
    ctxReviewer = { ...ctx, userId: reviewerUserId, role: "HR_ADMIN", requestId: "pol-test-rev" };

    const schedule = await workforceSvc.createWorkSchedule(ctx, { name: `PolDay-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
    const employee = await employeeService.createEmployee(ctx, {
      firstName: "Pol",
      lastName: `Plain-${Date.now()}`,
      workEmail: `pol-plain-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branch!.id,
    });
    employeeId = employee.id;
    await workforceSvc.assignEmployeeSchedule(ctx, employeeId, { workScheduleId: schedule.id, effectiveFrom: "2026-01-01" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await db.delete(schema.companies).where(eq(schema.companies.id, companyAId));
    await db.delete(schema.companies).where(eq(schema.companies.id, companyBId));
    await db.delete(schema.users).where(eq(schema.users.id, adminUserId));
    await db.delete(schema.users).where(eq(schema.users.id, reviewerUserId));
    await pool.end();
  });

  describe("service", () => {
    it("returns the built-in defaults when a company has no row (and creates none)", async () => {
      const view = await policySvc.getAttendancePolicy(ctxB);
      expect(view).toMatchObject({
        defaultGracePeriodMinutes: 0,
        earlyDepartureGraceMinutes: 0,
        overtimeThresholdMinutes: 0,
        minimumWorkedMinutes: null,
        isDefault: true,
      });
      expect(await policyRepo.attendancePolicyRepository.getEffectiveFor(companyBId, "2099-01-01")).toBeNull();
      expect(await policySvc.resolveAttendancePolicy(companyBId, "2026-03-02")).toEqual({
        defaultGracePeriodMinutes: 0,
        earlyDepartureGraceMinutes: 0,
        overtimeThresholdMinutes: 0,
        minimumWorkedMinutes: null,
      });
    });

    it("creates then updates the policy (one row per company), auditing both", async () => {
      const created = await policySvc.updateAttendancePolicy(ctx, VALID);
      expect(created).toMatchObject({ ...VALID, isDefault: false });

      const updated = await policySvc.updateAttendancePolicy(ctx, { ...VALID, overtimeThresholdMinutes: 30, minimumWorkedMinutes: null });
      expect(updated).toMatchObject({ overtimeThresholdMinutes: 30, minimumWorkedMinutes: null });

      const rows = await db.select().from(schema.attendancePolicies).where(eq(schema.attendancePolicies.companyId, companyAId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.updatedByUserId).toBe(adminUserId);

      const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.companyId, companyAId));
      expect(audits.filter((a) => a.action === "attendance.policy.update")).toHaveLength(2);
    });

    it("is company-isolated: another company's policy is never returned or modified", async () => {
      await policySvc.updateAttendancePolicy(ctx, VALID);
      expect((await policySvc.getAttendancePolicy(ctxB)).isDefault).toBe(true);

      await policySvc.updateAttendancePolicy(ctxB, { ...VALID, defaultGracePeriodMinutes: 99 });
      expect((await policySvc.getAttendancePolicy(ctx)).defaultGracePeriodMinutes).toBe(10);
      expect((await policySvc.getAttendancePolicy(ctxB)).defaultGracePeriodMinutes).toBe(99);
    });

    it("rejects negative, fractional, and out-of-range values", async () => {
      for (const bad of [
        { ...VALID, defaultGracePeriodMinutes: -1 },
        { ...VALID, earlyDepartureGraceMinutes: -5 },
        { ...VALID, overtimeThresholdMinutes: -1 },
        { ...VALID, minimumWorkedMinutes: -1 },
        { ...VALID, defaultGracePeriodMinutes: 1.5 },
        { ...VALID, defaultGracePeriodMinutes: 241 },
        { ...VALID, earlyDepartureGraceMinutes: 241 },
        { ...VALID, overtimeThresholdMinutes: 481 },
        { ...VALID, minimumWorkedMinutes: 1441 },
      ]) {
        await expect(policySvc.updateAttendancePolicy(ctx, bad)).rejects.toThrow(ValidationError);
      }
    });

    it("accepts a null minimum worked (UNDER_HOURS disabled) and zero values", async () => {
      const view = await policySvc.updateAttendancePolicy(ctx, {
        defaultGracePeriodMinutes: 0,
        earlyDepartureGraceMinutes: 0,
        overtimeThresholdMinutes: 0,
        minimumWorkedMinutes: null,
      });
      expect(view.minimumWorkedMinutes).toBeNull();
    });

    it("enforces permissions: HR_MANAGER can view but not update; MANAGER can do neither", async () => {
      await expect(policySvc.getAttendancePolicy(ctxHrManager)).resolves.toBeDefined();
      await expect(policySvc.updateAttendancePolicy(ctxHrManager, VALID)).rejects.toThrow(AuthorizationError);
      await expect(policySvc.getAttendancePolicy(ctxManager)).rejects.toThrow(AuthorizationError);
      await expect(policySvc.updateAttendancePolicy(ctxManager, VALID)).rejects.toThrow(AuthorizationError);
    });

    it("the DB check constraint rejects negative values even if validation were bypassed", async () => {
      await expect(policyRepo.attendancePolicyRepository.upsert(companyBId, "2026-01-01", { ...VALID, overtimeThresholdMinutes: -1 }, null)).rejects.toThrow();
    });
  });

  describe("central recalculation path", () => {
    // F-06: these tests calculate dates in March 2026, and a policy now applies from its effective date
    // forward, so the fixture policy is effective from the start of 2026 (a service save would start
    // today, which is correctly AFTER these dates and would not apply to them).
    async function setPolicy(policy: typeof VALID | { defaultGracePeriodMinutes: number; earlyDepartureGraceMinutes: number; overtimeThresholdMinutes: number; minimumWorkedMinutes: number | null }) {
      await policyRepo.attendancePolicyRepository.upsert(companyAId, "2026-01-01", policy, adminUserId);
    }

    it("no policy row -> today's behavior; a saved policy changes only later calculations", async () => {
      await db.delete(schema.attendancePolicies).where(eq(schema.attendancePolicies.companyId, companyAId));

      vi.setSystemTime(new Date("2026-03-02T09:00:00Z"));
      await attendanceSvc.checkIn(ctx, employeeId);
      vi.setSystemTime(new Date("2026-03-02T15:00:00Z"));
      await attendanceSvc.checkOut(ctx, employeeId);
      vi.useRealTimers();

      const before = await attendanceSvc.recalculateDailyRecord(ctx, employeeId, "2026-03-02");
      expect(before).toMatchObject({ status: "PRESENT", workedMinutes: 360, earlyDepartureMinutes: 180 });

      // Saving a policy does not touch the existing record...
      await setPolicy({ ...VALID, minimumWorkedMinutes: 420 });
      const [stored] = await db.select().from(schema.attendanceDailyRecords).where(eq(schema.attendanceDailyRecords.employeeId, employeeId));
      expect(stored!.status).toBe("PRESENT");

      // ...but the next calculation uses it: worked 360 < min(420, scheduled 540) -> UNDER_HOURS, early 180 - 5 = 175.
      const after = await attendanceSvc.recalculateDailyRecord(ctx, employeeId, "2026-03-02");
      expect(after).toMatchObject({ status: "UNDER_HOURS", earlyDepartureMinutes: 175 });
    });

    it("loads the policy exactly once per recalculation and passes it to the engine", async () => {
      await setPolicy(VALID);
      const spy = vi.spyOn(policyRepo.attendancePolicyRepository, "getEffectiveFor");
      await attendanceSvc.recalculateDailyRecord(ctx, employeeId, "2026-03-02");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0]).toBe(companyAId);
    });

    it("freezes the fallback grace on the session at check-in; shift grace stays authoritative", async () => {
      await setPolicy({ ...VALID, defaultGracePeriodMinutes: 30, minimumWorkedMinutes: null });

      vi.setSystemTime(new Date("2026-03-03T09:20:00Z"));
      const session = await attendanceSvc.checkIn(ctx, employeeId);
      vi.setSystemTime(new Date("2026-03-03T18:00:00Z"));
      await attendanceSvc.checkOut(ctx, employeeId);
      vi.useRealTimers();
      expect(session.gracePeriodMinutes).toBe(30);

      // 20 minutes after start is inside the 30-minute fallback grace -> not late.
      expect(await attendanceSvc.recalculateDailyRecord(ctx, employeeId, "2026-03-03")).toMatchObject({ status: "PRESENT", lateMinutes: 0 });

      // Changing the policy later does not rewrite the session's frozen grace, even on recalculation.
      await setPolicy({ ...VALID, defaultGracePeriodMinutes: 0, minimumWorkedMinutes: null });
      expect(await attendanceSvc.recalculateDailyRecord(ctx, employeeId, "2026-03-03")).toMatchObject({ status: "PRESENT", lateMinutes: 0 });

      // A shift's own grace is never replaced by the policy fallback.
      const shift = await workforceSvc.createShift(ctx, {
        name: `PolShift-${Date.now()}`,
        code: `POL_SHIFT_${Date.now()}`,
        startTime: "09:00:00",
        endTime: "18:00:00",
        gracePeriodMinutes: 5,
      });
      const shiftEmployee = await employeeService.createEmployee(ctx, {
        firstName: "Pol",
        lastName: `Shift-${Date.now()}`,
        workEmail: `pol-shift-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
      });
      const [schedule] = await db.select().from(schema.workSchedules).where(eq(schema.workSchedules.companyId, companyAId)).limit(1);
      await workforceSvc.assignEmployeeSchedule(ctx, shiftEmployee.id, { workScheduleId: schedule!.id, shiftId: shift.id, effectiveFrom: "2026-01-01" });
      await setPolicy({ ...VALID, defaultGracePeriodMinutes: 120, minimumWorkedMinutes: null });
      vi.setSystemTime(new Date("2026-03-04T09:00:00Z"));
      const shiftSession = await attendanceSvc.checkIn(ctx, shiftEmployee.id);
      vi.useRealTimers();
      expect(shiftSession.gracePeriodMinutes).toBe(5);
    });

    it("correction approval recalculates through the same path, with the policy applied to the synthetic session", async () => {
      await setPolicy({ ...VALID, defaultGracePeriodMinutes: 30, minimumWorkedMinutes: null });
      const correction = await attendanceSvc.requestCorrection(ctx, employeeId, {
        workDate: "2026-03-10",
        fieldChanged: "CHECK_IN",
        correctedValue: new Date("2026-03-10T09:20:00Z"),
        reason: "Forgot to check in — policy path test",
      });
      const spy = vi.spyOn(policyRepo.attendancePolicyRepository, "getEffectiveFor");
      await attendanceSvc.approveCorrection(ctxReviewer, correction.id);
      expect(spy).toHaveBeenCalled();

      const { record } = await attendanceSvc.getAttendanceDay(ctx, employeeId, "2026-03-10");
      // Synthetic session (no check-out yet) is INCOMPLETE, and its 20-minute lateness falls inside the 30-minute fallback grace.
      expect(record).toMatchObject({ status: "INCOMPLETE", lateMinutes: 0 });
    });
  });

  // F-06 - the policy that governs a work date is the one effective ON that date.
  describe("effective-dated policy (F-06)", () => {
    type Pol = { defaultGracePeriodMinutes: number; earlyDepartureGraceMinutes: number; overtimeThresholdMinutes: number; minimumWorkedMinutes: number | null };
    const P1: Pol = { defaultGracePeriodMinutes: 0, earlyDepartureGraceMinutes: 0, overtimeThresholdMinutes: 0, minimumWorkedMinutes: 420 }; // from 2026-01-01
    const P2: Pol = { defaultGracePeriodMinutes: 0, earlyDepartureGraceMinutes: 0, overtimeThresholdMinutes: 0, minimumWorkedMinutes: null }; // from 2026-04-01
    const upsert = (from: string, policy: Pol) => policyRepo.attendancePolicyRepository.upsert(companyAId, from, policy, adminUserId);

    // A fresh employee per test: a check-in's work date depends on the employee's previous session, so
    // tests that jump around in (fake) time must not share one.
    async function freshEmployee() {
      const [schedule] = await db.select().from(schema.workSchedules).where(eq(schema.workSchedules.companyId, companyAId)).limit(1);
      const e = await employeeService.createEmployee(ctx, {
        firstName: "PolF06",
        lastName: `E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        workEmail: `pol-f06-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`,
        dateOfJoining: "2020-01-01",
      });
      await workforceSvc.assignEmployeeSchedule(ctx, e.id, { workScheduleId: schedule!.id, effectiveFrom: "2026-01-01" });
      return e.id;
    }

    async function worked6h(id: string, workDate: string) {
      vi.setSystemTime(new Date(`${workDate}T09:00:00Z`));
      await attendanceSvc.checkIn(ctx, id);
      vi.setSystemTime(new Date(`${workDate}T15:00:00Z`));
      await attendanceSvc.checkOut(ctx, id); // 6h < 7h minimum
      vi.useRealTimers();
    }

    it("resolves the row in force on each date: defaults before the first policy, then each policy from its own start", async () => {
      await db.delete(schema.attendancePolicies).where(eq(schema.attendancePolicies.companyId, companyAId));
      await upsert("2026-01-01", P1);
      await upsert("2026-04-01", P2);

      expect((await policySvc.resolveAttendancePolicy(companyAId, "2025-12-31")).minimumWorkedMinutes).toBeNull(); // defaults
      expect((await policySvc.resolveAttendancePolicy(companyAId, "2026-01-01")).minimumWorkedMinutes).toBe(420);
      expect((await policySvc.resolveAttendancePolicy(companyAId, "2026-03-31")).minimumWorkedMinutes).toBe(420);
      expect((await policySvc.resolveAttendancePolicy(companyAId, "2026-04-01")).minimumWorkedMinutes).toBeNull();
      expect((await policySvc.resolveAttendancePolicy(companyAId, "2099-01-01")).minimumWorkedMinutes).toBeNull();
    });

    it("attendance before and after a policy change is calculated under its own policy, and history stays put on recalculation", async () => {
      await db.delete(schema.attendancePolicies).where(eq(schema.attendancePolicies.companyId, companyAId));
      await upsert("2026-01-01", P1);
      const employeeId = await freshEmployee();
      await worked6h(employeeId, "2026-03-16"); // before the change
      await worked6h(employeeId, "2026-04-14"); // after the change

      // Only P1 exists so far: both dates are UNDER_HOURS.
      expect((await attendanceSvc.recalculateDailyRecord(ctx, employeeId, "2026-03-16")).status).toBe("UNDER_HOURS");

      await upsert("2026-04-01", P2); // the policy changes: minimum no longer applies FROM 1 April

      // Historical recalculation: March keeps P1 (still UNDER_HOURS); April uses P2 (now PRESENT).
      expect((await attendanceSvc.recalculateDailyRecord(ctx, employeeId, "2026-03-16")).status).toBe("UNDER_HOURS");
      expect((await attendanceSvc.recalculateDailyRecord(ctx, employeeId, "2026-04-14")).status).toBe("PRESENT");
    });

    it("saving through the service takes effect from the company's today and never reaches earlier dates", async () => {
      await db.delete(schema.attendancePolicies).where(eq(schema.attendancePolicies.companyId, companyAId));
      const employeeId = await freshEmployee();
      await worked6h(employeeId, "2026-03-17");
      expect((await attendanceSvc.recalculateDailyRecord(ctx, employeeId, "2026-03-17")).status).toBe("PRESENT"); // defaults, no policy yet

      const saved = await policySvc.updateAttendancePolicy(ctx, { ...P1, minimumWorkedMinutes: 480 });
      expect(saved.effectiveFrom).toBe(new Date().toISOString().slice(0, 10)); // company timezone is UTC

      expect((await attendanceSvc.recalculateDailyRecord(ctx, employeeId, "2026-03-17")).status).toBe("PRESENT"); // history unchanged
      expect((await policySvc.resolveAttendancePolicy(companyAId, saved.effectiveFrom!)).minimumWorkedMinutes).toBe(480);

      // A second save on the same day replaces that day's row; it never adds a second one.
      await policySvc.updateAttendancePolicy(ctx, { ...P1, minimumWorkedMinutes: 300 });
      const rows = await db.select().from(schema.attendancePolicies).where(eq(schema.attendancePolicies.companyId, companyAId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.minimumWorkedMinutes).toBe(300);
    });

    it("correction approval uses the policy effective on the corrected work date", async () => {
      await db.delete(schema.attendancePolicies).where(eq(schema.attendancePolicies.companyId, companyAId));
      await upsert("2026-01-01", { ...P1, minimumWorkedMinutes: null, defaultGracePeriodMinutes: 30 });
      await upsert("2026-06-01", { ...P1, minimumWorkedMinutes: null, defaultGracePeriodMinutes: 0 }); // changes later
      const employeeId = await freshEmployee();

      const correction = await attendanceSvc.requestCorrection(ctx, employeeId, {
        workDate: "2026-03-12",
        fieldChanged: "CHECK_IN",
        correctedValue: new Date("2026-03-12T09:20:00Z"),
        reason: "Forgot to check in",
      });
      await attendanceSvc.approveCorrection(ctxReviewer, correction.id);
      // 20 minutes late is inside the 30-minute grace that was in force in March - not today's 0.
      const { record } = await attendanceSvc.getAttendanceDay(ctx, employeeId, "2026-03-12");
      expect(record).toMatchObject({ status: "INCOMPLETE", lateMinutes: 0 });
    });

    it("Process Day (manual) and the scheduled job both apply the policy effective on the processed date", async () => {
      await db.delete(schema.attendancePolicies).where(eq(schema.attendancePolicies.companyId, companyAId));
      await upsert("2026-01-01", P1);
      await upsert("2026-04-01", P2);
      const processing = await import("../../processing/attendance-processing.service");
      const auto = await import("../../processing/attendance-auto-processing.service");
      const employeeId = await freshEmployee();

      // Manual: the same 6h day on either side of the change.
      await worked6h(employeeId, "2026-03-18");
      await worked6h(employeeId, "2026-04-15");
      expect((await processing.processEmployeeAttendanceDay(ctx, { employeeId, workDate: "2026-03-18" })).status).toBe("UNDER_HOURS");
      expect((await processing.processEmployeeAttendanceDay(ctx, { employeeId, workDate: "2026-04-15" })).status).toBe("PRESENT");

      // Scheduled: a closed 6h session with NO daily record yet, materialized by the job.
      for (const [date, expected] of [["2026-03-19", "UNDER_HOURS"], ["2026-04-16", "PRESENT"]] as const) {
        const [session] = await db
          .insert(schema.attendanceOpenSessions)
          .values({
            companyId: companyAId,
            employeeId,
            workDate: date,
            status: "CLOSED",
            checkInAt: new Date(`${date}T09:00:00Z`),
            checkOutAt: new Date(`${date}T15:00:00Z`),
            expectedStartAt: new Date(`${date}T09:00:00Z`),
            expectedEndAt: new Date(`${date}T18:00:00Z`),
          })
          .returning();
        await db.insert(schema.attendanceEvents).values([
          { companyId: companyAId, employeeId, sessionId: session!.id, workDate: date, eventType: "CHECK_IN", occurredAt: new Date(`${date}T09:00:00Z`) },
          { companyId: companyAId, employeeId, sessionId: session!.id, workDate: date, eventType: "CHECK_OUT", occurredAt: new Date(`${date}T15:00:00Z`) },
        ]);
        await auto.processCompanyWorkDate(companyAId, date, "SCHEDULED");
        const row = await db.query.attendanceDailyRecords.findFirst({
          where: (t, { and, eq: dbEq }) => and(dbEq(t.employeeId, employeeId), dbEq(t.workDate, date)),
        });
        expect(row?.status).toBe(expected);
      }
    });
  });
});
