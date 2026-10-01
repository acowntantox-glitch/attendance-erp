import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";

const available = await isDatabaseAvailable();

// The default 10s hook timeout is occasionally too tight for beforeAll's several sequential
// real-Postgres round-trips under network latency (same class of flakiness already documented for
// individual tests below) — widen both.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

describe.skipIf(!available)("attendance service", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let svc: typeof import("../service");
  let errors: typeof import("../errors");
  let workforceSvc: typeof import("@/domains/workforce/service");
  let employeeService: typeof import("@/domains/employee/service");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;
  let EmployeeNotFoundError: typeof import("@/domains/employee/errors").EmployeeNotFoundError;

  let companyAId: string;
  let companyBId: string;
  let branchId: string;
  let adminUserId: string;
  let reviewerUserId: string;
  let ctx: import("@/lib/auth/request-context").RequestContext;
  let ctxCompanyB: import("@/lib/auth/request-context").RequestContext;
  let ctxManager: import("@/lib/auth/request-context").RequestContext;
  // Batch 12 — a distinct HR_ADMIN user, never the requester in any pre-existing test below.
  // Self-approval is now forbidden, so a test that both requests and reviews a correction under
  // the exact same user (as every pre-Batch-12 lifecycle/concurrency/rollback test originally did
  // with `ctx`) must review with a *different* eligible user instead — this is that user.
  let ctxReviewer: import("@/lib/auth/request-context").RequestContext;

  // Assignments are effective from well before any test date below and never closed, so every
  // fixed test timestamp (all in 2026, after 2026-01-01) resolves against them unambiguously.
  const ASSIGNMENT_START = "2026-01-01";

  let employeeAId: string; // plain 09:00-18:00 schedule, no shift, grace = 0
  let employeeGraceId: string; // 09:00-18:00 shift with a 15-minute grace period
  let employeeNightId: string; // 22:00-06:00 overnight shift
  let employeeNoScheduleId: string; // no assignment at all

  function ctxFor(overrides: Partial<import("@/lib/auth/request-context").RequestContext>) {
    return { ...ctx, requestId: `att-test-${Date.now()}-${Math.random()}`, ...overrides };
  }

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    svc = await import("../service");
    errors = await import("../errors");
    workforceSvc = await import("@/domains/workforce/service");
    employeeService = await import("@/domains/employee/service");
    ({ AuthorizationError } = await import("@/lib/errors"));
    ({ EmployeeNotFoundError } = await import("@/domains/employee/errors"));

    const [companyA] = await db
      .insert(schema.companies)
      .values({ name: "Attendance Test Co A", code: `ATT_TEST_A_${Date.now()}`, timezone: "UTC" })
      .returning();
    const [companyB] = await db
      .insert(schema.companies)
      .values({ name: "Attendance Test Co B", code: `ATT_TEST_B_${Date.now()}`, timezone: "UTC" })
      .returning();
    companyAId = companyA!.id;
    companyBId = companyB!.id;

    const [branch] = await db
      .insert(schema.branches)
      .values({ companyId: companyAId, name: "HQ", code: "ATT_TEST_HQ", timezone: "UTC" })
      .returning();
    branchId = branch!.id;

    const [adminUser] = await db
      .insert(schema.users)
      .values({ email: `att-admin-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Attendance Test Admin" })
      .returning();
    adminUserId = adminUser!.id;

    ctx = {
      requestId: "att-test",
      userId: adminUserId,
      userEmail: adminUser!.email,
      companyId: companyAId,
      role: "COMPANY_ADMIN",
      employeeId: null,
    };
    ctxCompanyB = { ...ctx, companyId: companyBId, requestId: "att-test-b" };
    ctxManager = { ...ctx, role: "MANAGER", requestId: "att-test-manager" };

    const [reviewerUser] = await db
      .insert(schema.users)
      .values({ email: `att-reviewer-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Attendance Test Reviewer" })
      .returning();
    reviewerUserId = reviewerUser!.id;
    await db.insert(schema.companyMemberships).values({ userId: reviewerUserId, companyId: companyAId, role: "HR_ADMIN" });
    ctxReviewer = { ...ctx, userId: reviewerUserId, role: "HR_ADMIN", requestId: "att-test-reviewer" };

    const daySchedule = await workforceSvc.createWorkSchedule(ctx, {
      name: `AttDay-${Date.now()}`,
      startTime: "09:00:00",
      endTime: "18:00:00",
    });
    const graceShift = await workforceSvc.createShift(ctx, {
      name: `AttGrace-${Date.now()}`,
      code: `ATT_GRACE_${Date.now()}`,
      startTime: "09:00:00",
      endTime: "18:00:00",
      gracePeriodMinutes: 15,
    });
    const nightShift = await workforceSvc.createShift(ctx, {
      name: `AttNight-${Date.now()}`,
      code: `ATT_NIGHT_${Date.now()}`,
      startTime: "22:00:00",
      endTime: "06:00:00",
    });

    const employeeA = await employeeService.createEmployee(ctx, {
      firstName: "Att",
      lastName: `Plain-${Date.now()}`,
      workEmail: `att-plain-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branchId,
    });
    employeeAId = employeeA.id;
    await workforceSvc.assignEmployeeSchedule(ctx, employeeAId, { workScheduleId: daySchedule.id, effectiveFrom: ASSIGNMENT_START });

    const employeeGrace = await employeeService.createEmployee(ctx, {
      firstName: "Att",
      lastName: `Grace-${Date.now()}`,
      workEmail: `att-grace-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branchId,
    });
    employeeGraceId = employeeGrace.id;
    await workforceSvc.assignEmployeeSchedule(ctx, employeeGraceId, {
      workScheduleId: daySchedule.id,
      shiftId: graceShift.id,
      effectiveFrom: ASSIGNMENT_START,
    });

    const employeeNight = await employeeService.createEmployee(ctx, {
      firstName: "Att",
      lastName: `Night-${Date.now()}`,
      workEmail: `att-night-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branchId,
    });
    employeeNightId = employeeNight.id;
    await workforceSvc.assignEmployeeSchedule(ctx, employeeNightId, {
      workScheduleId: daySchedule.id,
      shiftId: nightShift.id,
      effectiveFrom: ASSIGNMENT_START,
    });

    const employeeNoSchedule = await employeeService.createEmployee(ctx, {
      firstName: "Att",
      lastName: `NoSchedule-${Date.now()}`,
      workEmail: `att-noschedule-${Date.now()}@test.local`,
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
    await db.delete(schema.users).where(eq(schema.users.id, reviewerUserId));
    await pool.end();
  });

  describe("check-in / check-out", () => {
    it("checks in and out, producing a PRESENT daily record with the plain schedule's snapshot", async () => {
      vi.setSystemTime(new Date("2026-02-02T09:00:00Z"));
      const session = await svc.checkIn(ctx, employeeAId);
      expect(session.status).toBe("OPEN");
      expect(session.workDate).toBe("2026-02-02");
      expect(session.expectedStartAt?.toISOString()).toBe("2026-02-02T09:00:00.000Z");
      expect(session.expectedEndAt?.toISOString()).toBe("2026-02-02T18:00:00.000Z");
      expect(session.gracePeriodMinutes).toBe(0);

      vi.setSystemTime(new Date("2026-02-02T18:00:00Z"));
      const closed = await svc.checkOut(ctx, employeeAId);
      expect(closed.status).toBe("CLOSED");

      const { record } = await svc.getAttendanceDay(ctx, employeeAId, "2026-02-02");
      expect(record.status).toBe("PRESENT");
      expect(record.scheduledMinutes).toBe(540);
      expect(record.workedMinutes).toBe(540);
      expect(record.overtimeMinutes).toBe(0);
      expect(record.lateMinutes).toBe(0);
    });

    it("rejects a second check-in while a session is already open for the same work date", async () => {
      vi.setSystemTime(new Date("2026-02-03T09:00:00Z"));
      await svc.checkIn(ctx, employeeAId);
      await expect(svc.checkIn(ctx, employeeAId)).rejects.toThrow(errors.AlreadyCheckedInError);
      await svc.checkOut(ctx, employeeAId);
    });

    it("rejects check-out with no open session", async () => {
      await expect(svc.checkOut(ctx, employeeAId)).rejects.toThrow(errors.NoOpenSessionError);
    });

    it("is idempotent: a retried check-in with the same idempotency key returns the original session, not a duplicate", async () => {
      vi.setSystemTime(new Date("2026-02-04T09:00:00Z"));
      const key = `idem-${Date.now()}`;
      const first = await svc.checkIn(ctx, employeeAId, { idempotencyKey: key });
      const retry = await svc.checkIn(ctx, employeeAId, { idempotencyKey: key });
      expect(retry.id).toBe(first.id);
      await svc.checkOut(ctx, employeeAId);
    });

    it("applies the shift's grace period before counting late minutes", async () => {
      vi.setSystemTime(new Date("2026-02-05T09:10:00Z"));
      await svc.checkIn(ctx, employeeGraceId);
      vi.setSystemTime(new Date("2026-02-05T18:00:00Z"));
      await svc.checkOut(ctx, employeeGraceId);

      const { record } = await svc.getAttendanceDay(ctx, employeeGraceId, "2026-02-05");
      expect(record.lateMinutes).toBe(0); // 10 minutes late, 15-minute grace
      expect(record.status).toBe("PRESENT");
    });

    it("counts late minutes beyond the grace period and marks the day LATE", async () => {
      vi.setSystemTime(new Date("2026-02-06T09:30:00Z"));
      await svc.checkIn(ctx, employeeGraceId);
      vi.setSystemTime(new Date("2026-02-06T18:00:00Z"));
      await svc.checkOut(ctx, employeeGraceId);

      const { record } = await svc.getAttendanceDay(ctx, employeeGraceId, "2026-02-06");
      expect(record.lateMinutes).toBe(15); // 30 minutes late - 15-minute grace
      expect(record.status).toBe("LATE");
    });

    it("supports multiple closed sessions on the same work date, summing worked minutes once each", async () => {
      vi.setSystemTime(new Date("2026-02-07T09:00:00Z"));
      await svc.checkIn(ctx, employeeAId);
      vi.setSystemTime(new Date("2026-02-07T12:00:00Z"));
      await svc.checkOut(ctx, employeeAId);

      vi.setSystemTime(new Date("2026-02-07T14:00:00Z"));
      await svc.checkIn(ctx, employeeAId);
      vi.setSystemTime(new Date("2026-02-07T19:00:00Z"));
      await svc.checkOut(ctx, employeeAId);

      const { record, sessions } = await svc.getAttendanceDay(ctx, employeeAId, "2026-02-07");
      expect(sessions).toHaveLength(2);
      expect(record.scheduledMinutes).toBe(540); // counted once, not per session
      expect(record.workedMinutes).toBe(480); // 180 + 300
      expect(record.overtimeMinutes).toBe(0);

      // Each session's own display-only duration (not an authoritative total — the day-level
      // figures above already are) is reported per session, for the "Today's Sessions" UI table.
      const [first, second] = sessions.sort((a, b) => a.checkInAt.getTime() - b.checkInAt.getTime());
      expect(first!.sessionWorkedMinutes).toBe(180);
      expect(second!.sessionWorkedMinutes).toBe(300);
      expect(first!.sessionWorkedMinutes! + second!.sessionWorkedMinutes!).toBe(record.workedMinutes);
    });

    it("tracks breaks and subtracts closed break minutes from worked time, and reports it per session too", async () => {
      vi.setSystemTime(new Date("2026-02-08T09:00:00Z"));
      await svc.checkIn(ctx, employeeAId);
      vi.setSystemTime(new Date("2026-02-08T13:00:00Z"));
      await svc.startBreak(ctx, employeeAId);
      vi.setSystemTime(new Date("2026-02-08T13:30:00Z"));
      await svc.endBreak(ctx, employeeAId);
      vi.setSystemTime(new Date("2026-02-08T18:00:00Z"));
      await svc.checkOut(ctx, employeeAId);

      const { record, sessions } = await svc.getAttendanceDay(ctx, employeeAId, "2026-02-08");
      expect(record.breakMinutes).toBe(30);
      expect(record.workedMinutes).toBe(510);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.sessionBreakMinutes).toBe(30);
      expect(sessions[0]!.sessionWorkedMinutes).toBe(510);
    });

    it("rejects check-out while a break is still open, and rejects ending a break with none open", async () => {
      vi.setSystemTime(new Date("2026-02-09T09:00:00Z"));
      await svc.checkIn(ctx, employeeAId);
      await expect(svc.endBreak(ctx, employeeAId)).rejects.toThrow(errors.NoOpenBreakError);
      // Each event needs a distinct instant: events are ordered by `occurredAt` alone, so a
      // BREAK_START and BREAK_END frozen at the same millisecond have no defined order.
      vi.setSystemTime(new Date("2026-02-09T12:00:00Z"));
      await svc.startBreak(ctx, employeeAId);
      await expect(svc.checkOut(ctx, employeeAId)).rejects.toThrow(errors.OpenBreakExistsError);
      vi.setSystemTime(new Date("2026-02-09T12:30:00Z"));
      await svc.endBreak(ctx, employeeAId);
      vi.setSystemTime(new Date("2026-02-09T18:00:00Z"));
      await svc.checkOut(ctx, employeeAId);
    });

    it("getCurrentSession reports hasOpenBreak accurately, and never fabricates a worked duration for an open session", async () => {
      // A dedicated employee, not employeeAId — findMostRecentForEmployee orders by real
      // checkInAt, so reusing a shared fixture at a date that doesn't fall after every other test
      // using it (this test sits before the Feb-10/11 "missing checkout" tests in file order, but
      // Feb 12 > Feb 10/11) would corrupt those tests' workDate-inheritance resolution.
      const employee = await employeeService.createEmployee(ctx, {
        firstName: "CurrentSession",
        lastName: `Break-${Date.now()}`,
        workEmail: `att-current-session-break-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });

      vi.setSystemTime(new Date("2026-02-12T09:00:00Z"));
      await svc.checkIn(ctx, employee.id);

      let { session, hasOpenBreak } = await svc.getCurrentSession(ctx, employee.id);
      expect(session!.status).toBe("OPEN");
      expect(session!.sessionWorkedMinutes).toBeNull(); // not yet checked out — never fabricated
      expect(hasOpenBreak).toBe(false);

      vi.setSystemTime(new Date("2026-02-12T11:00:00Z"));
      await svc.startBreak(ctx, employee.id);
      ({ session, hasOpenBreak } = await svc.getCurrentSession(ctx, employee.id));
      expect(hasOpenBreak).toBe(true);

      vi.setSystemTime(new Date("2026-02-12T11:15:00Z"));
      await svc.endBreak(ctx, employee.id);
      ({ session, hasOpenBreak } = await svc.getCurrentSession(ctx, employee.id));
      expect(hasOpenBreak).toBe(false);

      vi.setSystemTime(new Date("2026-02-12T18:00:00Z"));
      await svc.checkOut(ctx, employee.id);
      const closed = await svc.getCurrentSession(ctx, employee.id);
      expect(closed.session).toBeNull();
      expect(closed.hasOpenBreak).toBe(false);
    });

    it("Batch 11 hardening: rejects check-in for an employee whose employment status is no longer ACTIVE", async () => {
      const employee = await employeeService.createEmployee(ctx, {
        firstName: "Att",
        lastName: `Terminated-${Date.now()}`,
        workEmail: `att-terminated-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      await employeeService.changeEmployeeStatus(ctx, employee.id, "TERMINATED");

      await expect(svc.checkIn(ctx, employee.id)).rejects.toThrow(errors.EmployeeNotEligibleForProcessingError);
    });

    it("Batch 11 hardening: rejects check-in for an archived employee", async () => {
      const employee = await employeeService.createEmployee(ctx, {
        firstName: "Att",
        lastName: `Archived-${Date.now()}`,
        workEmail: `att-archived-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      await employeeService.archiveEmployee(ctx, employee.id);

      await expect(svc.checkIn(ctx, employee.id)).rejects.toThrow(errors.EmployeeNotEligibleForProcessingError);
    });
  });

  describe("missing checkout / abandonment", () => {
    it("marks a day with an unclosed session INCOMPLETE, and still allows check-in on a later work date (auto-abandon)", async () => {
      vi.setSystemTime(new Date("2026-02-10T09:00:00Z"));
      const open = await svc.checkIn(ctx, employeeAId);
      expect(open.status).toBe("OPEN");

      const { record } = await svc.getAttendanceDay(ctx, employeeAId, "2026-02-10");
      expect(record.status).toBe("INCOMPLETE");
      expect(record.workedMinutes).toBeNull();

      // A day later, resolved fresh (well past the abandoned session's expectedEndAt) — must not
      // be blocked by the never-closed prior session.
      vi.setSystemTime(new Date("2026-02-11T09:00:00Z"));
      const next = await svc.checkIn(ctx, employeeAId);
      expect(next.workDate).toBe("2026-02-11");
      expect(next.id).not.toBe(open.id);

      const { session: abandoned } = await svc.getCurrentSession(ctx, employeeAId);
      expect(abandoned!.id).toBe(next.id); // the old one is no longer OPEN

      await svc.checkOut(ctx, employeeAId);
    });
  });

  describe("overnight work-date resolution (Case 5/6/7)", () => {
    it("Case 5: an overnight check-in/check-out pair belongs to the day the shift starts", async () => {
      vi.setSystemTime(new Date("2026-03-01T22:00:00Z"));
      const session = await svc.checkIn(ctx, employeeNightId);
      expect(session.workDate).toBe("2026-03-01");
      expect(session.expectedEndAt?.toISOString()).toBe("2026-03-02T06:00:00.000Z");

      vi.setSystemTime(new Date("2026-03-02T06:00:00Z"));
      const closed = await svc.checkOut(ctx, employeeNightId);
      expect(closed.workDate).toBe("2026-03-01");

      const { record } = await svc.getAttendanceDay(ctx, employeeNightId, "2026-03-01");
      expect(record.scheduledMinutes).toBe(480);
      expect(record.workedMinutes).toBe(480);
    });

    it("Case 6: a second check-in before the prior session's expectedEndAt inherits its work date", async () => {
      vi.setSystemTime(new Date("2026-03-05T22:00:00Z"));
      const first = await svc.checkIn(ctx, employeeNightId);
      vi.setSystemTime(new Date("2026-03-05T23:00:00Z"));
      await svc.checkOut(ctx, employeeNightId);

      // 01:00 the next calendar day is still before first.expectedEndAt (06:00) — must inherit.
      vi.setSystemTime(new Date("2026-03-06T01:00:00Z"));
      const second = await svc.checkIn(ctx, employeeNightId);
      expect(second.workDate).toBe(first.workDate);
      expect(second.workDate).toBe("2026-03-05");

      vi.setSystemTime(new Date("2026-03-06T05:00:00Z"));
      await svc.checkOut(ctx, employeeNightId);

      const { sessions } = await svc.getAttendanceDay(ctx, employeeNightId, "2026-03-05");
      expect(sessions).toHaveLength(2);
    });

    it("Case 7: a second check-in after the prior session's expectedEndAt resolves a fresh work date", async () => {
      vi.setSystemTime(new Date("2026-03-10T22:00:00Z"));
      await svc.checkIn(ctx, employeeNightId);
      vi.setSystemTime(new Date("2026-03-10T23:00:00Z"));
      await svc.checkOut(ctx, employeeNightId);

      // Well after the first session's expectedEndAt (2026-03-11T06:00Z) — resolves fresh.
      vi.setSystemTime(new Date("2026-03-11T22:00:00Z"));
      const second = await svc.checkIn(ctx, employeeNightId);
      expect(second.workDate).toBe("2026-03-11");
      await svc.checkOut(ctx, employeeNightId);
    });
  });

  describe("mid-day reassignment normalization (Round 4 amendment)", () => {
    it("one continuous session under schedule A is unaffected by a same-day reassignment to schedule B captured by no event", async () => {
      const scheduleB = await workforceSvc.createWorkSchedule(ctx, { name: `MidDayB-${Date.now()}`, startTime: "14:00:00", endTime: "22:00:00" });

      const employee = await employeeService.createEmployee(ctx, {
        firstName: "MidDay",
        lastName: `OneSession-${Date.now()}`,
        workEmail: `att-midday-one-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      const scheduleA = await workforceSvc.createWorkSchedule(ctx, { name: `MidDayA-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: scheduleA.id, effectiveFrom: ASSIGNMENT_START });

      vi.setSystemTime(new Date("2026-04-01T09:00:00Z"));
      await svc.checkIn(ctx, employee.id); // captures schedule A's snapshot

      // HR reassigns effective the same day, mid-session — Workforce's own assignment semantics
      // are date-granular (see resolveEmployeeTimezone/getWorkforceDayInfo): this auto-closes A to
      // the day before, per assignEmployeeSchedule's existing logic.
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: scheduleB.id, effectiveFrom: "2026-04-01" });

      vi.setSystemTime(new Date("2026-04-01T18:00:00Z"));
      await svc.checkOut(ctx, employee.id); // still the SAME session — no new event ever captured B

      const { record } = await svc.getAttendanceDay(ctx, employee.id, "2026-04-01");
      expect(record.scheduledMinutes).toBe(540); // A's window only
      expect(record.workedMinutes).toBe(540);
      expect(record.overtimeMinutes).toBe(0);
    });

    it("a real second check-in after the same-day reassignment captures the new snapshot and normalizes against it", async () => {
      const scheduleB = await workforceSvc.createWorkSchedule(ctx, { name: `MidDayB2-${Date.now()}`, startTime: "14:00:00", endTime: "22:00:00" });
      const scheduleA = await workforceSvc.createWorkSchedule(ctx, { name: `MidDayA2-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });

      const employee = await employeeService.createEmployee(ctx, {
        firstName: "MidDay",
        lastName: `TwoSessions-${Date.now()}`,
        workEmail: `att-midday-two-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: scheduleA.id, effectiveFrom: ASSIGNMENT_START });

      vi.setSystemTime(new Date("2026-04-05T09:00:00Z"));
      await svc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date("2026-04-05T14:00:00Z"));
      await svc.checkOut(ctx, employee.id);

      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: scheduleB.id, effectiveFrom: "2026-04-05" });

      vi.setSystemTime(new Date("2026-04-05T14:00:00Z"));
      await svc.checkIn(ctx, employee.id); // captures B's snapshot
      vi.setSystemTime(new Date("2026-04-05T18:00:00Z"));
      await svc.checkOut(ctx, employee.id);

      const { record } = await svc.getAttendanceDay(ctx, employee.id, "2026-04-05");
      expect(record.scheduledMinutes).toBe(780); // A truncated to 09-14 (300) + B 14-22 (480)
      expect(record.workedMinutes).toBe(540); // 09:00-14:00 + 14:00-18:00
      expect(record.overtimeMinutes).toBe(0);
      expect(record.earlyDepartureMinutes).toBe(240); // vs B's 22:00 end
    });

    it("Hardening Case C: one continuous session that works past A's own end into where B's window would be — B still has zero effect", async () => {
      const scheduleB = await workforceSvc.createWorkSchedule(ctx, { name: `MidDayC-B-${Date.now()}`, startTime: "16:00:00", endTime: "22:00:00" });
      const scheduleA = await workforceSvc.createWorkSchedule(ctx, { name: `MidDayC-A-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });

      const employee = await employeeService.createEmployee(ctx, {
        firstName: "MidDay",
        lastName: `CaseC-${Date.now()}`,
        workEmail: `att-midday-casec-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: scheduleA.id, effectiveFrom: ASSIGNMENT_START });

      vi.setSystemTime(new Date("2026-04-10T09:00:00Z"));
      await svc.checkIn(ctx, employee.id); // captures A's snapshot only

      // HR reassigns to B mid-session — no new check-in event ever observes it.
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: scheduleB.id, effectiveFrom: "2026-04-10" });

      vi.setSystemTime(new Date("2026-04-10T22:00:00Z"));
      await svc.checkOut(ctx, employee.id); // same session throughout, checkout extends past A's 18:00 end

      const { record } = await svc.getAttendanceDay(ctx, employee.id, "2026-04-10");
      expect(record.scheduledMinutes).toBe(540); // A only
      expect(record.workedMinutes).toBe(780);
      expect(record.overtimeMinutes).toBe(240);
      expect(record.earlyDepartureMinutes).toBe(0);
    });
  });

  describe("holiday / weekly-off / no-schedule", () => {
    it("classifies a worked holiday as HOLIDAY_WORKED with all worked minutes as overtime", async () => {
      const holidayDate = "2026-05-01";
      await workforceSvc.createHoliday(ctx, { name: `Att Test Holiday ${Date.now()}`, date: holidayDate, holidayType: "PUBLIC" });

      vi.setSystemTime(new Date(`${holidayDate}T09:00:00Z`));
      await svc.checkIn(ctx, employeeAId);
      vi.setSystemTime(new Date(`${holidayDate}T13:00:00Z`));
      await svc.checkOut(ctx, employeeAId);

      const { record } = await svc.getAttendanceDay(ctx, employeeAId, holidayDate);
      expect(record.status).toBe("HOLIDAY_WORKED");
      expect(record.scheduledMinutes).toBe(0);
      expect(record.overtimeMinutes).toBe(record.workedMinutes);
      expect(record.lateMinutes).toBeNull();
    });

    it("classifies a worked weekly-off day as WEEKLY_OFF_WORKED with all worked minutes as overtime", async () => {
      const weeklyOffDate = "2026-05-09";
      const dow = new Date(`${weeklyOffDate}T12:00:00Z`).getUTCDay();

      const employee = await employeeService.createEmployee(ctx, {
        firstName: "Att",
        lastName: `WeeklyOff-${Date.now()}`,
        workEmail: `att-weeklyoff-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      // An employee-specific override scoped tightly to this one date, so it cannot leak into any
      // other employee or any other test's dates (a company-wide default would).
      await workforceSvc.setEmployeeWeeklyOffOverride(ctx, employee.id, {
        offDays: [dow],
        effectiveFrom: weeklyOffDate,
        effectiveTo: weeklyOffDate,
      });

      vi.setSystemTime(new Date(`${weeklyOffDate}T09:00:00Z`));
      await svc.checkIn(ctx, employee.id);
      vi.setSystemTime(new Date(`${weeklyOffDate}T11:00:00Z`));
      await svc.checkOut(ctx, employee.id);

      const { record } = await svc.getAttendanceDay(ctx, employee.id, weeklyOffDate);
      expect(record.status).toBe("WEEKLY_OFF_WORKED");
      expect(record.scheduledMinutes).toBe(0);
      expect(record.overtimeMinutes).toBe(record.workedMinutes);
    });

    it("allows check-in with no schedule assignment at all, classified NO_SCHEDULE with zero scheduled minutes", async () => {
      vi.setSystemTime(new Date("2026-05-15T09:00:00Z"));
      await svc.checkIn(ctx, employeeNoScheduleId);
      vi.setSystemTime(new Date("2026-05-15T13:00:00Z"));
      await svc.checkOut(ctx, employeeNoScheduleId);

      const { record } = await svc.getAttendanceDay(ctx, employeeNoScheduleId, "2026-05-15");
      expect(record.status).toBe("NO_SCHEDULE");
      expect(record.scheduledMinutes).toBe(0);
    });

    it("CONFIRMED POLICY (Batch 1 closure): no-schedule check-in requires no HR override, mutates no Workforce data, and produces the exact specified daily-record shape", async () => {
      const employee = await employeeService.createEmployee(ctx, {
        firstName: "NoSchedule",
        lastName: `Policy-${Date.now()}`,
        workEmail: `att-noschedule-policy-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });

      const assignmentsBefore = await workforceSvc.listEmployeeScheduleAssignments(ctx, employee.id);
      expect(assignmentsBefore).toHaveLength(0);

      // A plain EMPLOYEE-role self-check-in — no HR_ADMIN/HR_MANAGER involvement, no special
      // override permission beyond the ordinary attendance.check_in every EMPLOYEE already has.
      const employeeCtx = ctxFor({ role: "EMPLOYEE", employeeId: employee.id, userId: adminUserId });
      vi.setSystemTime(new Date("2026-05-20T09:00:00Z"));
      const session = await svc.checkIn(employeeCtx, employee.id);
      expect(session.status).toBe("OPEN");
      expect(session.expectedStartAt).toBeNull();
      expect(session.expectedEndAt).toBeNull();

      vi.setSystemTime(new Date("2026-05-20T15:00:00Z"));
      await svc.checkOut(employeeCtx, employee.id);

      const { record } = await svc.getAttendanceDay(ctx, employee.id, "2026-05-20");
      expect(record.status).toBe("NO_SCHEDULE");
      expect(record.scheduledMinutes).toBe(0);
      expect(record.workedMinutes).toBe(360);
      expect(record.lateMinutes).toBeNull();
      expect(record.earlyDepartureMinutes).toBeNull();
      expect(record.overtimeMinutes).toBe(record.workedMinutes);

      // No Workforce mutation occurred as a side effect of checking in with no assignment.
      const assignmentsAfter = await workforceSvc.listEmployeeScheduleAssignments(ctx, employee.id);
      expect(assignmentsAfter).toHaveLength(0);
    });
  });

  describe("RBAC and self-scope", () => {
    it("pins an EMPLOYEE-role caller to their own employee record regardless of the requested id", async () => {
      const employeeCtx = ctxFor({ role: "EMPLOYEE", employeeId: employeeAId, userId: adminUserId });
      vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));
      // Passing employeeGraceId as the target — must still check the EMPLOYEE ctx's own employee in.
      const session = await svc.checkIn(employeeCtx, employeeGraceId);
      expect(session.employeeId).toBe(employeeAId);
      await svc.checkOut(employeeCtx, employeeGraceId);
    });

    it("rejects an EMPLOYEE-role caller with no linked employee record", async () => {
      const orphanCtx = ctxFor({ role: "EMPLOYEE", employeeId: null });
      await expect(svc.checkIn(orphanCtx, employeeAId)).rejects.toThrow(EmployeeNotFoundError);
    });

    it("Batch 2 security: EMPLOYEE viewing/checking-out/breaking against a specific other employee's id always resolves to the caller's own data, never the other employee's", async () => {
      const caller = await employeeService.createEmployee(ctx, {
        firstName: "SelfScope",
        lastName: `Caller-${Date.now()}`,
        workEmail: `att-selfscope-caller-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      const other = await employeeService.createEmployee(ctx, {
        firstName: "SelfScope",
        lastName: `Other-${Date.now()}`,
        workEmail: `att-selfscope-other-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      const callerCtx = ctxFor({ role: "EMPLOYEE", employeeId: caller.id, userId: adminUserId });

      vi.setSystemTime(new Date("2026-06-15T09:00:00Z"));

      // Passing `other.id` as the target on every call — every result must reflect `caller`, and
      // `other` must remain completely untouched (no session ever created for them).
      const checkInSession = await svc.checkIn(callerCtx, other.id);
      expect(checkInSession.employeeId).toBe(caller.id);

      // Distinct instants for the break pair (events are ordered by `occurredAt` alone).
      vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
      const breakEvent = await svc.startBreak(callerCtx, other.id);
      expect(breakEvent.employeeId).toBe(caller.id);
      vi.setSystemTime(new Date("2026-06-15T12:30:00Z"));
      await svc.endBreak(callerCtx, other.id);

      const { session: current } = await svc.getCurrentSession(callerCtx, other.id);
      expect(current!.employeeId).toBe(caller.id);

      const { record, sessions } = await svc.getAttendanceDay(callerCtx, other.id, "2026-06-15");
      expect(record.employeeId).toBe(caller.id);
      expect(sessions.every((s) => s.employeeId === caller.id)).toBe(true);

      const checkOutSession = await svc.checkOut(callerCtx, other.id);
      expect(checkOutSession.employeeId).toBe(caller.id);

      // `other` was never touched by any of the above.
      const { session: otherCurrent } = await svc.getCurrentSession(ctx, other.id);
      expect(otherCurrent).toBeNull();
      const { sessions: otherSessions } = await svc.getAttendanceDay(ctx, other.id, "2026-06-15");
      expect(otherSessions).toHaveLength(0);
    });

    it("does not grant MANAGER correction approve/reject", async () => {
      await expect(svc.approveCorrection(ctxManager, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(AuthorizationError);
      await expect(svc.rejectCorrection(ctxManager, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(AuthorizationError);
    });

    it("does not grant MANAGER attendance.recalculate", async () => {
      await expect(svc.recalculateDailyRecord(ctxManager, employeeAId, "2026-06-01")).rejects.toThrow(AuthorizationError);
    });
  });

  describe("tenant isolation", () => {
    it("rejects check-in for an employee belonging to another company", async () => {
      await expect(svc.checkIn(ctxCompanyB, employeeAId)).rejects.toThrow(AuthorizationError);
    });

    it("rejects viewing another company's employee attendance", async () => {
      await expect(svc.getAttendanceDay(ctxCompanyB, employeeAId, "2026-02-02")).rejects.toThrow(AuthorizationError);
    });

    it("rejects check-out for an employee belonging to another company", async () => {
      await expect(svc.checkOut(ctxCompanyB, employeeAId)).rejects.toThrow(AuthorizationError);
    });
  });

  describe("concurrency", () => {
    it("allows only one of two truly concurrent check-in requests to succeed", async () => {
      const employee = await employeeService.createEmployee(ctx, {
        firstName: "Race",
        lastName: `CheckIn-${Date.now()}`,
        workEmail: `att-race-checkin-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });

      const [a, b] = await Promise.allSettled([svc.checkIn(ctx, employee.id), svc.checkIn(ctx, employee.id)]);
      const outcomes = [a, b];
      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      const rejected = outcomes.filter((o) => o.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(errors.AlreadyCheckedInError);

      // Exactly one OPEN session exists — the partial unique index (and, for the abandon path, the
      // FOR UPDATE lock) prevented a second one from ever being created.
      const { session: current } = await svc.getCurrentSession(ctx, employee.id);
      expect(current).not.toBeNull();
      await svc.checkOut(ctx, employee.id);
    });

    it("allows only one of two truly concurrent check-out requests to succeed, and never duplicates the CHECK_OUT event", async () => {
      const employee = await employeeService.createEmployee(ctx, {
        firstName: "Race",
        lastName: `CheckOut-${Date.now()}`,
        workEmail: `att-race-checkout-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      const session = await svc.checkIn(ctx, employee.id);

      const [a, b] = await Promise.allSettled([svc.checkOut(ctx, employee.id), svc.checkOut(ctx, employee.id)]);
      const outcomes = [a, b];
      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      const rejected = outcomes.filter((o) => o.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(errors.NoOpenSessionError);

      const events = await db.query.attendanceEvents.findMany({
        where: eq(schema.attendanceEvents.sessionId, session.id),
      });
      expect(events.filter((e) => e.eventType === "CHECK_OUT")).toHaveLength(1);
    });

    it("does not let one employee's check-out close another employee's open session", async () => {
      const employeeX = await employeeService.createEmployee(ctx, {
        firstName: "Race",
        lastName: `OtherX-${Date.now()}`,
        workEmail: `att-race-x-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      const employeeY = await employeeService.createEmployee(ctx, {
        firstName: "Race",
        lastName: `OtherY-${Date.now()}`,
        workEmail: `att-race-y-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });

      const sessionX = await svc.checkIn(ctx, employeeX.id);
      // employeeY has no open session at all.
      await expect(svc.checkOut(ctx, employeeY.id)).rejects.toThrow(errors.NoOpenSessionError);

      const { session: stillOpenX } = await svc.getCurrentSession(ctx, employeeX.id);
      expect(stillOpenX!.id).toBe(sessionX.id);
      expect(stillOpenX!.status).toBe("OPEN");

      await svc.checkOut(ctx, employeeX.id);
    });
  });

  describe("corrections", () => {
    it("supports the full request -> approve lifecycle, auditing both steps", async () => {
      const correction = await svc.requestCorrection(ctx, employeeAId, {
        workDate: "2026-02-20",
        fieldChanged: "CHECK_IN",
        correctedValue: new Date("2026-02-20T09:00:00Z"),
        reason: "Forgot to check in — approved late arrival due to public transport delay",
      });
      expect(correction.status).toBe("PENDING");

      // Batch 12 — reviewed by a different user than the requester (`ctx`), since self-approval
      // is now forbidden; the lifecycle/audit behavior under test is otherwise unchanged.
      const approved = await svc.approveCorrection(ctxReviewer, correction.id, { reviewNote: "Confirmed with manager" });
      expect(approved.status).toBe("APPROVED");
      expect(approved.reviewedByUserId).toBe(reviewerUserId);

      await expect(svc.approveCorrection(ctxReviewer, correction.id)).rejects.toThrow(errors.CorrectionAlreadyReviewedError);
    });

    it("supports rejection", async () => {
      const correction = await svc.requestCorrection(ctx, employeeAId, {
        workDate: "2026-02-21",
        fieldChanged: "CHECK_IN",
        correctedValue: new Date("2026-02-21T09:00:00Z"),
        reason: "Requesting an adjustment",
      });
      // Batch 12 — reviewed by a different user than the requester; see the note above.
      const rejected = await svc.rejectCorrection(ctxReviewer, correction.id, { reviewNote: "Not enough evidence" });
      expect(rejected.status).toBe("REJECTED");
    });

    it("lists an employee's own corrections and the company-wide queue", async () => {
      const mine = await svc.listCorrectionsForEmployee(ctx, employeeAId);
      expect(mine.length).toBeGreaterThan(0);

      const pending = await svc.listCompanyCorrections(ctx, "PENDING");
      expect(Array.isArray(pending)).toBe(true);
    });

    it("EMPLOYEE self-scope: a correction request is always filed under the caller's own employeeId, even if a different employeeId is passed", async () => {
      const employeeCtx = ctxFor({ role: "EMPLOYEE", employeeId: employeeAId, userId: adminUserId });
      const correction = await svc.requestCorrection(employeeCtx, employeeGraceId, {
        workDate: "2026-02-22",
        fieldChanged: "CHECK_IN",
        correctedValue: new Date("2026-02-22T09:00:00Z"),
        reason: "Employee A trying to request on behalf of Employee Grace",
      });
      expect(correction.employeeId).toBe(employeeAId);
    });

    it("MANAGER can request a correction for an employee on their team (F-02) but cannot approve or reject one", async () => {
      const teamManager = await employeeService.createEmployee(ctx, {
        firstName: "Team",
        lastName: `Mgr-${Date.now()}`,
        workEmail: `att-teammgr-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      await db.update(schema.employees).set({ managerId: teamManager.id }).where(eq(schema.employees.id, employeeGraceId));
      const ctxManagerOfGrace = { ...ctxManager, employeeId: teamManager.id };
      const correction = await svc.requestCorrection(ctxManagerOfGrace, employeeGraceId, {
        workDate: "2026-02-23",
        fieldChanged: "CHECK_IN",
        correctedValue: new Date("2026-02-23T09:00:00Z"),
        reason: "Manager requesting on behalf of a report",
      });
      expect(correction.employeeId).toBe(employeeGraceId);

      await expect(svc.approveCorrection(ctxManager, correction.id)).rejects.toThrow(AuthorizationError);
      await expect(svc.rejectCorrection(ctxManager, correction.id)).rejects.toThrow(AuthorizationError);

      // Read-only for the HR queue too — the backend enforces this, not just hidden buttons.
      await expect(svc.listCompanyCorrections(ctxManager)).rejects.toThrow(AuthorizationError);
      await db.update(schema.employees).set({ managerId: null }).where(eq(schema.employees.id, employeeGraceId));

      const detail = await svc.getCorrectionDetail(ctx, correction.id);
      expect(detail.status).toBe("PENDING");
    });

    it("EMPLOYEE cannot view another employee's correction detail, and cannot reach the HR queue", async () => {
      const correction = await svc.requestCorrection(ctx, employeeGraceId, {
        workDate: "2026-02-24",
        fieldChanged: "CHECK_IN",
        correctedValue: new Date("2026-02-24T09:00:00Z"),
        reason: "Grace's own correction",
      });

      const employeeCtx = ctxFor({ role: "EMPLOYEE", employeeId: employeeAId, userId: adminUserId });
      await expect(svc.getCorrectionDetail(employeeCtx, correction.id)).rejects.toThrow(AuthorizationError);
      await expect(svc.listCompanyCorrections(employeeCtx)).rejects.toThrow(AuthorizationError);

      const graceCtx = ctxFor({ role: "EMPLOYEE", employeeId: employeeGraceId, userId: adminUserId });
      const own = await svc.getCorrectionDetail(graceCtx, correction.id);
      expect(own.id).toBe(correction.id);
    });

    it("tenant isolation: Company B cannot view, approve, or reject a Company A correction", async () => {
      const correction = await svc.requestCorrection(ctx, employeeAId, {
        workDate: "2026-02-25",
        fieldChanged: "CHECK_IN",
        correctedValue: new Date("2026-02-25T09:00:00Z"),
        reason: "Company A correction",
      });

      await expect(svc.getCorrectionDetail(ctxCompanyB, correction.id)).rejects.toThrow(AuthorizationError);
      await expect(svc.approveCorrection(ctxCompanyB, correction.id)).rejects.toThrow(AuthorizationError);
      await expect(svc.rejectCorrection(ctxCompanyB, correction.id)).rejects.toThrow(AuthorizationError);

      const stillPending = await svc.getCorrectionDetail(ctx, correction.id);
      expect(stillPending.status).toBe("PENDING");
    });

    it("rejects a second correction that would conflict with an already-pending one for the same employee/work date/field", async () => {
      await svc.requestCorrection(ctx, employeeGraceId, {
        workDate: "2026-02-26",
        fieldChanged: "CHECK_IN",
        correctedValue: new Date("2026-02-26T09:00:00Z"),
        reason: "First correction for this day",
      });

      await expect(
        svc.requestCorrection(ctx, employeeGraceId, {
          workDate: "2026-02-26",
          fieldChanged: "CHECK_IN",
          correctedValue: new Date("2026-02-26T09:05:00Z"),
          reason: "Conflicting second correction for the same day/field",
        }),
      ).rejects.toThrow(errors.ConflictingCorrectionError);
    });

    it("rejects a missing-checkout correction when there is no unique open session to attach it to", async () => {
      // employeeNoScheduleId has never checked in on this date at all — zero open sessions.
      await expect(
        svc.requestCorrection(ctx, employeeNoScheduleId, {
          workDate: "2026-02-27",
          fieldChanged: "CHECK_OUT",
          correctedValue: new Date("2026-02-27T18:00:00Z"),
          reason: "No session exists to attach this to",
        }),
      ).rejects.toThrow(errors.InvalidCorrectionTargetError);
    });

    it("rejects a correction whose eventId exists but doesn't match the field being corrected", async () => {
      vi.setSystemTime(new Date("2026-02-28T09:00:00Z"));
      const session = await svc.checkIn(ctx, employeeGraceId);
      vi.setSystemTime(new Date("2026-02-28T18:00:00Z"));
      await svc.checkOut(ctx, employeeGraceId);
      // Select by type: an unordered findMany gives no guarantee the CHECK_IN row comes first.
      const checkInEvent = await db.query.attendanceEvents.findFirst({
        where: and(eq(schema.attendanceEvents.sessionId, session.id), eq(schema.attendanceEvents.eventType, "CHECK_IN")),
      });

      vi.setSystemTime(new Date("2026-02-28" + "T23:30:00Z")); // F-07-bump: a correction can only name a time that has already happened
      await expect(
        svc.requestCorrection(ctx, employeeGraceId, {
          workDate: "2026-02-28",
          fieldChanged: "CHECK_OUT", // wrong field for a CHECK_IN event
          eventId: checkInEvent!.id,
          correctedValue: new Date("2026-02-28T18:30:00Z"),
          reason: "Field mismatch should be rejected",
        }),
      ).rejects.toThrow(errors.InvalidCorrectionEventError);
    });

    describe("Batch 11 hardening: timestamp ordering", () => {
      it("rejects a CHECK_OUT correction proposing a time before the session's own check-in", async () => {
        vi.setSystemTime(new Date("2026-03-10T09:00:00Z"));
        await svc.checkIn(ctx, employeeGraceId);
        vi.setSystemTime(new Date("2026-03-10T18:00:00Z"));
        await svc.checkOut(ctx, employeeGraceId);

        vi.setSystemTime(new Date("2026-03-10" + "T23:30:00Z")); // F-07-bump: a correction can only name a time that has already happened
        await expect(
          svc.requestCorrection(ctx, employeeGraceId, {
            workDate: "2026-03-10",
            fieldChanged: "CHECK_OUT",
            correctedValue: new Date("2026-03-10T08:30:00Z"), // before the 09:00 check-in
            reason: "Typo — should never be accepted",
          }),
        ).rejects.toThrow(errors.InvalidCorrectionTargetError);
      });

      it("rejects a CHECK_IN correction proposing a time after the session's own check-out", async () => {
        vi.setSystemTime(new Date("2026-03-11T09:00:00Z"));
        const session = await svc.checkIn(ctx, employeeGraceId);
        vi.setSystemTime(new Date("2026-03-11T18:00:00Z"));
        await svc.checkOut(ctx, employeeGraceId);
        const [checkInEvent] = await db.query.attendanceEvents.findMany({
          where: and(eq(schema.attendanceEvents.sessionId, session.id), eq(schema.attendanceEvents.eventType, "CHECK_IN")),
        });

        vi.setSystemTime(new Date("2026-03-11" + "T23:30:00Z")); // F-07-bump: a correction can only name a time that has already happened
        await expect(
          svc.requestCorrection(ctx, employeeGraceId, {
            workDate: "2026-03-11",
            fieldChanged: "CHECK_IN",
            eventId: checkInEvent!.id,
            correctedValue: new Date("2026-03-11T19:00:00Z"), // after the 18:00 check-out
            reason: "Typo — should never be accepted",
          }),
        ).rejects.toThrow(errors.InvalidCorrectionTargetError);
      });

      it("rejects a BREAK_END correction proposing a time before its own break's start, and a BREAK_START correction proposing a time after its own break's end", async () => {
        vi.setSystemTime(new Date("2026-03-12T09:00:00Z"));
        await svc.checkIn(ctx, employeeGraceId);
        vi.setSystemTime(new Date("2026-03-12T13:00:00Z"));
        const breakStart = await svc.startBreak(ctx, employeeGraceId);
        vi.setSystemTime(new Date("2026-03-12T13:30:00Z"));
        const breakEnd = await svc.endBreak(ctx, employeeGraceId);
        vi.setSystemTime(new Date("2026-03-12T18:00:00Z"));
        await svc.checkOut(ctx, employeeGraceId);

        vi.setSystemTime(new Date("2026-03-12" + "T23:30:00Z")); // F-07-bump: a correction can only name a time that has already happened
        await expect(
          svc.requestCorrection(ctx, employeeGraceId, {
            workDate: "2026-03-12",
            fieldChanged: "BREAK_END",
            eventId: breakEnd.id,
            correctedValue: new Date("2026-03-12T12:45:00Z"), // before the 13:00 break-start
            reason: "Typo — should never be accepted",
          }),
        ).rejects.toThrow(errors.InvalidCorrectionTargetError);

        vi.setSystemTime(new Date("2026-03-12" + "T23:30:00Z")); // F-07-bump: a correction can only name a time that has already happened
        await expect(
          svc.requestCorrection(ctx, employeeGraceId, {
            workDate: "2026-03-12",
            fieldChanged: "BREAK_START",
            eventId: breakStart.id,
            correctedValue: new Date("2026-03-12T13:45:00Z"), // after the 13:30 break-end
            reason: "Typo — should never be accepted",
          }),
        ).rejects.toThrow(errors.InvalidCorrectionTargetError);
      });

      it("still accepts a validly-ordered BREAK_START correction and recalculates break minutes correctly once approved", async () => {
        vi.setSystemTime(new Date("2026-03-13T09:00:00Z"));
        await svc.checkIn(ctx, employeeGraceId);
        vi.setSystemTime(new Date("2026-03-13T13:00:00Z"));
        const breakStart = await svc.startBreak(ctx, employeeGraceId);
        vi.setSystemTime(new Date("2026-03-13T13:30:00Z"));
        await svc.endBreak(ctx, employeeGraceId);
        vi.setSystemTime(new Date("2026-03-13T18:00:00Z"));
        await svc.checkOut(ctx, employeeGraceId);

        const before = await svc.getAttendanceDay(ctx, employeeGraceId, "2026-03-13");
        expect(before.record.breakMinutes).toBe(30);

        vi.setSystemTime(new Date("2026-03-13" + "T23:30:00Z")); // F-07-bump: a correction can only name a time that has already happened
        const correction = await svc.requestCorrection(ctx, employeeGraceId, {
          workDate: "2026-03-13",
          fieldChanged: "BREAK_START",
          eventId: breakStart.id,
          correctedValue: new Date("2026-03-13T12:45:00Z"), // still after check-in, still before break-end
          reason: "Break actually started 15 minutes earlier",
        });
        // Batch 12 — reviewed by a different user than the requester; see the note above.
        await svc.approveCorrection(ctxReviewer, correction.id);

        const after = await svc.getAttendanceDay(ctx, employeeGraceId, "2026-03-13");
        expect(after.record.breakMinutes).toBe(45); // 12:45-13:30
      });
    });

    it("an APPROVED missing-checkout correction recalculates the day (no longer INCOMPLETE); PENDING and REJECTED have no effect", async () => {
      vi.setSystemTime(new Date("2026-03-15T09:00:00Z"));
      await svc.checkIn(ctx, employeeGraceId);
      // Forgot to check out — the session stays OPEN.

      const before = await svc.getAttendanceDay(ctx, employeeGraceId, "2026-03-15");
      expect(before.record.status).toBe("INCOMPLETE");

      vi.setSystemTime(new Date("2026-03-15" + "T23:30:00Z")); // F-07-bump: a correction can only name a time that has already happened
      const correction = await svc.requestCorrection(ctx, employeeGraceId, {
        workDate: "2026-03-15",
        fieldChanged: "CHECK_OUT",
        correctedValue: new Date("2026-03-15T18:00:00Z"),
        reason: "Forgot to check out",
      });
      expect(correction.status).toBe("PENDING");

      // PENDING: no effect on calculation.
      const stillPending = await svc.getAttendanceDay(ctx, employeeGraceId, "2026-03-15");
      expect(stillPending.record.status).toBe("INCOMPLETE");

      // Batch 12 — reviewed by a different user than the requester; see the note above.
      const approved = await svc.approveCorrection(ctxReviewer, correction.id, { reviewNote: "Confirmed via manual timesheet" });
      expect(approved.status).toBe("APPROVED");

      const after = await svc.getAttendanceDay(ctx, employeeGraceId, "2026-03-15");
      expect(after.record.status).not.toBe("INCOMPLETE");
      expect(after.record.workedMinutes).toBe(540);

      const logs = await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.entityId, correction.id) });
      expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["attendance.correction.create", "attendance.correction.approve"]));
    });

    it("a REJECTED correction never recalculates the day", async () => {
      vi.setSystemTime(new Date("2026-03-16T09:00:00Z"));
      await svc.checkIn(ctx, employeeGraceId);

      vi.setSystemTime(new Date("2026-03-16" + "T23:30:00Z")); // F-07-bump: a correction can only name a time that has already happened
      const correction = await svc.requestCorrection(ctx, employeeGraceId, {
        workDate: "2026-03-16",
        fieldChanged: "CHECK_OUT",
        correctedValue: new Date("2026-03-16T18:00:00Z"),
        reason: "Forgot to check out",
      });

      // Batch 12 — reviewed by a different user than the requester; see the note above.
      const rejected = await svc.rejectCorrection(ctxReviewer, correction.id, { reviewNote: "Insufficient evidence" });
      expect(rejected.status).toBe("REJECTED");

      const record = await svc.getAttendanceDay(ctx, employeeGraceId, "2026-03-16");
      expect(record.record.status).toBe("INCOMPLETE");
    });

    it("prevents double approval under concurrency — exactly one of two simultaneous approve attempts succeeds", async () => {
      const correction = await svc.requestCorrection(ctx, employeeGraceId, {
        workDate: "2026-03-17",
        fieldChanged: "CHECK_IN",
        correctedValue: new Date("2026-03-17T09:00:00Z"),
        reason: "Race test",
      });

      // Batch 12 — reviewed by a different user than the requester; see the note above.
      const [a, b] = await Promise.allSettled([
        svc.approveCorrection(ctxReviewer, correction.id),
        svc.approveCorrection(ctxReviewer, correction.id),
      ]);
      const outcomes = [a, b];
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      const rejectedOutcomes = outcomes.filter((o) => o.status === "rejected");
      expect(rejectedOutcomes).toHaveLength(1);
      expect((rejectedOutcomes[0] as PromiseRejectedResult).reason).toBeInstanceOf(errors.CorrectionAlreadyReviewedError);

      const final = await svc.getCorrectionDetail(ctx, correction.id);
      expect(final.status).toBe("APPROVED");
    });

    it("a recalculation failure during approval rolls back the whole transaction — the correction remains PENDING, not partially APPROVED", async () => {
      vi.setSystemTime(new Date("2026-03-18T09:00:00Z"));
      await svc.checkIn(ctx, employeeGraceId);
      // Forgot to check out — exactly one open session exists right now, so this is a valid target.
      vi.setSystemTime(new Date("2026-03-18" + "T23:30:00Z")); // F-07-bump: a correction can only name a time that has already happened
      const correction = await svc.requestCorrection(ctx, employeeGraceId, {
        workDate: "2026-03-18",
        fieldChanged: "CHECK_OUT",
        correctedValue: new Date("2026-03-18T18:00:00Z"),
        reason: "Forgot to check out",
      });

      // The employee actually checks out normally before HR gets to review the request — the
      // "exactly one open session" target the request relied on no longer exists at approval time.
      vi.setSystemTime(new Date("2026-03-18T17:00:00Z"));
      await svc.checkOut(ctx, employeeGraceId);

      // Batch 12 — reviewed by a different user than the requester; see the note above.
      await expect(svc.approveCorrection(ctxReviewer, correction.id)).rejects.toThrow(errors.RecalculationFailedError);

      const stillPending = await svc.getCorrectionDetail(ctx, correction.id);
      expect(stillPending.status).toBe("PENDING");
      expect(stillPending.reviewedByUserId).toBeNull();

      const record = await svc.getAttendanceDay(ctx, employeeGraceId, "2026-03-18");
      expect(record.record.workedMinutes).toBe(480); // the real checkout (09:00-17:00), unaffected by the failed approval
    });
  });

  describe("Batch 12: correction approval hierarchy", () => {
    let employeeRoleUserId: string;
    let managerRoleUserId: string;
    let hrManagerRoleUserId: string;
    let hrAdminRoleUserId: string;
    let superAdminRoleUserId: string;
    let employeeRoleCtx: import("@/lib/auth/request-context").RequestContext;
    let managerRoleCtx: import("@/lib/auth/request-context").RequestContext;
    let hrManagerRoleCtx: import("@/lib/auth/request-context").RequestContext;
    let hrAdminRoleCtx: import("@/lib/auth/request-context").RequestContext;
    let superAdminRoleCtx: import("@/lib/auth/request-context").RequestContext;

    // A genuinely distinct user with a real `company_memberships` row at the given role — unlike
    // `ctxFor`, which only overrides the in-memory RequestContext.role for permission-check
    // purposes, `findActiveRolesForUsers` reads the real DB row, so testing the hierarchy policy
    // requires real, separate rows per role, not a shared `adminUserId` with an overridden ctx.
    async function createRoleUser(role: "EMPLOYEE" | "MANAGER" | "HR_MANAGER" | "HR_ADMIN" | "COMPANY_ADMIN" | "SUPER_ADMIN") {
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `batch12-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
          passwordHash: "unused",
          fullName: `Batch12 ${role}`,
        })
        .returning();
      await db.insert(schema.companyMemberships).values({ userId: user!.id, companyId: companyAId, role });
      return user!.id;
    }

    beforeAll(async () => {
      employeeRoleUserId = await createRoleUser("EMPLOYEE");
      managerRoleUserId = await createRoleUser("MANAGER");
      hrManagerRoleUserId = await createRoleUser("HR_MANAGER");
      hrAdminRoleUserId = await createRoleUser("HR_ADMIN");
      superAdminRoleUserId = await createRoleUser("SUPER_ADMIN");

      employeeRoleCtx = ctxFor({ role: "EMPLOYEE", userId: employeeRoleUserId, employeeId: employeeAId });
      managerRoleCtx = ctxFor({ role: "MANAGER", userId: managerRoleUserId, employeeId: null });
      hrManagerRoleCtx = ctxFor({ role: "HR_MANAGER", userId: hrManagerRoleUserId, employeeId: null });
      hrAdminRoleCtx = ctxFor({ role: "HR_ADMIN", userId: hrAdminRoleUserId, employeeId: null });
      superAdminRoleCtx = ctxFor({ role: "SUPER_ADMIN", userId: superAdminRoleUserId, employeeId: null });
    });

    afterAll(async () => {
      for (const id of [employeeRoleUserId, managerRoleUserId, hrManagerRoleUserId, hrAdminRoleUserId, superAdminRoleUserId]) {
        await db.delete(schema.users).where(eq(schema.users.id, id));
      }
    });

    describe("self-approval", () => {
      it("blocks a user from approving or rejecting their own correction, for every role that holds both request and approve permissions", async () => {
        const cases: [string, import("@/lib/auth/request-context").RequestContext][] = [
          ["HR_MANAGER", hrManagerRoleCtx],
          ["HR_ADMIN", hrAdminRoleCtx],
          ["COMPANY_ADMIN", ctx],
          ["SUPER_ADMIN", superAdminRoleCtx],
        ];
        let day = 1;
        for (const [, roleCtx] of cases) {
          const workDate = `2026-04-${String(day++).padStart(2, "0")}`;
          const correction = await svc.requestCorrection(roleCtx, employeeAId, {
            workDate,
            fieldChanged: "CHECK_IN",
            correctedValue: new Date(`${workDate}T09:00:00Z`),
            reason: "Self-approval attempt should be blocked",
          });
          await expect(svc.approveCorrection(roleCtx, correction.id)).rejects.toThrow(errors.SelfApprovalNotAllowedError);
          await expect(svc.rejectCorrection(roleCtx, correction.id)).rejects.toThrow(errors.SelfApprovalNotAllowedError);

          // Still PENDING — both attempts rolled back cleanly, not partially applied.
          const stillPending = await svc.getCorrectionDetail(ctx, correction.id);
          expect(stillPending.status).toBe("PENDING");
        }
      });
    });

    describe("hierarchy", () => {
      it("HR_MANAGER can approve a correction requested by EMPLOYEE", async () => {
        const correction = await svc.requestCorrection(employeeRoleCtx, employeeAId, {
          workDate: "2026-04-10",
          fieldChanged: "CHECK_IN",
          correctedValue: new Date("2026-04-10T09:00:00Z"),
          reason: "Employee request",
        });
        const approved = await svc.approveCorrection(hrManagerRoleCtx, correction.id);
        expect(approved.status).toBe("APPROVED");
      });

      it("HR_MANAGER can approve a correction requested by MANAGER", async () => {
        // F-02: the manager requests for someone on their own team.
        const teamManager = await employeeService.createEmployee(ctx, {
          firstName: "Hier",
          lastName: `Mgr-${Date.now()}`,
          workEmail: `att-hier-mgr-${Date.now()}@test.local`,
          dateOfJoining: "2020-01-01",
          locationId: branchId,
        });
        await db.update(schema.employees).set({ managerId: teamManager.id }).where(eq(schema.employees.id, employeeAId));
        const managerOfA = { ...managerRoleCtx, employeeId: teamManager.id };
        const correction = await svc.requestCorrection(managerOfA, employeeAId, {
          workDate: "2026-04-11",
          fieldChanged: "CHECK_IN",
          correctedValue: new Date("2026-04-11T09:00:00Z"),
          reason: "Manager request",
        });
        const approved = await svc.approveCorrection(hrManagerRoleCtx, correction.id);
        expect(approved.status).toBe("APPROVED");
        await db.update(schema.employees).set({ managerId: null }).where(eq(schema.employees.id, employeeAId));
      });

      it("HR_MANAGER cannot approve a correction requested by HR_ADMIN", async () => {
        const correction = await svc.requestCorrection(hrAdminRoleCtx, employeeAId, {
          workDate: "2026-04-12",
          fieldChanged: "CHECK_IN",
          correctedValue: new Date("2026-04-12T09:00:00Z"),
          reason: "HR_ADMIN request",
        });
        await expect(svc.approveCorrection(hrManagerRoleCtx, correction.id)).rejects.toThrow(errors.InsufficientCorrectionApprovalAuthorityError);
      });

      it("HR_ADMIN can approve a correction requested by HR_MANAGER", async () => {
        const correction = await svc.requestCorrection(hrManagerRoleCtx, employeeAId, {
          workDate: "2026-04-13",
          fieldChanged: "CHECK_IN",
          correctedValue: new Date("2026-04-13T09:00:00Z"),
          reason: "HR_MANAGER request",
        });
        const approved = await svc.approveCorrection(hrAdminRoleCtx, correction.id);
        expect(approved.status).toBe("APPROVED");
      });

      // NOTE: the read-only inspection's originally proposed policy table listed "HR_ADMIN cannot
      // approve a COMPANY_ADMIN correction," but this implementation task's own Business Rules
      // section explicitly overrides that for COMPANY_ADMIN/SUPER_ADMIN requesters: "preserve the
      // existing approval-permission model" (no added minimum) — so this test verifies the
      // *implemented* policy, which allows it (self-approval prevention is the only extra
      // constraint for these two requester roles). See the final report's "remaining limitation"
      // section for this discrepancy.
      it("HR_ADMIN CAN approve a correction requested by COMPANY_ADMIN — no added minimum for a COMPANY_ADMIN requester, per the explicit 'preserve existing approval-permission model' rule", async () => {
        const correction = await svc.requestCorrection(ctx, employeeAId, {
          workDate: "2026-04-14",
          fieldChanged: "CHECK_IN",
          correctedValue: new Date("2026-04-14T09:00:00Z"),
          reason: "COMPANY_ADMIN request",
        });
        const approved = await svc.approveCorrection(hrAdminRoleCtx, correction.id);
        expect(approved.status).toBe("APPROVED");
      });

      it("COMPANY_ADMIN can approve a correction requested by HR_ADMIN", async () => {
        const correction = await svc.requestCorrection(hrAdminRoleCtx, employeeAId, {
          workDate: "2026-04-15",
          fieldChanged: "CHECK_IN",
          correctedValue: new Date("2026-04-15T09:00:00Z"),
          reason: "HR_ADMIN request",
        });
        const approved = await svc.approveCorrection(ctx, correction.id);
        expect(approved.status).toBe("APPROVED");
      });
    });

    describe("current-role behavior", () => {
      it("evaluates approval authority using the requester's CURRENT role, not their role at request time (promotion after request)", async () => {
        const promotedUserId = await createRoleUser("HR_MANAGER");
        const promotedCtx = ctxFor({ role: "HR_MANAGER", userId: promotedUserId, employeeId: null });

        const correction = await svc.requestCorrection(promotedCtx, employeeAId, {
          workDate: "2026-04-16",
          fieldChanged: "CHECK_IN",
          correctedValue: new Date("2026-04-16T09:00:00Z"),
          reason: "Filed while still HR_MANAGER",
        });

        // Promoted to HR_ADMIN before anyone reviews it.
        await db
          .update(schema.companyMemberships)
          .set({ role: "HR_ADMIN" })
          .where(and(eq(schema.companyMemberships.userId, promotedUserId), eq(schema.companyMemberships.companyId, companyAId)));

        // An HR_MANAGER-level reviewer is no longer sufficient, now that the requester's CURRENT
        // role is HR_ADMIN (minimum COMPANY_ADMIN) — not their HR_MANAGER role at request time.
        await expect(svc.approveCorrection(hrManagerRoleCtx, correction.id)).rejects.toThrow(errors.InsufficientCorrectionApprovalAuthorityError);

        const approved = await svc.approveCorrection(ctx, correction.id);
        expect(approved.status).toBe("APPROVED");

        await db.delete(schema.users).where(eq(schema.users.id, promotedUserId));
      });

      it("evaluates approval authority using the requester's CURRENT role, not their role at request time (demotion after request)", async () => {
        const demotedUserId = await createRoleUser("HR_ADMIN");
        const demotedCtx = ctxFor({ role: "HR_ADMIN", userId: demotedUserId, employeeId: null });

        const correction = await svc.requestCorrection(demotedCtx, employeeAId, {
          workDate: "2026-04-17",
          fieldChanged: "CHECK_IN",
          correctedValue: new Date("2026-04-17T09:00:00Z"),
          reason: "Filed while still HR_ADMIN",
        });

        // Demoted to HR_MANAGER before anyone reviews it.
        await db
          .update(schema.companyMemberships)
          .set({ role: "HR_MANAGER" })
          .where(and(eq(schema.companyMemberships.userId, demotedUserId), eq(schema.companyMemberships.companyId, companyAId)));

        // An HR_ADMIN-level reviewer now suffices, because the requester's CURRENT role (demoted
        // to HR_MANAGER) only requires an HR_ADMIN minimum — not the COMPANY_ADMIN minimum their
        // original HR_ADMIN role at request time would have required.
        const approved = await svc.approveCorrection(hrAdminRoleCtx, correction.id);
        expect(approved.status).toBe("APPROVED");

        await db.delete(schema.users).where(eq(schema.users.id, demotedUserId));
      });
    });

    describe("self-approval after role change", () => {
      it("cannot be bypassed by promoting the requester to a role with no hierarchy minimum", async () => {
        const userId = await createRoleUser("HR_MANAGER");
        const requesterCtx = ctxFor({ role: "HR_MANAGER", userId, employeeId: null });

        const correction = await svc.requestCorrection(requesterCtx, employeeAId, {
          workDate: "2026-04-18",
          fieldChanged: "CHECK_IN",
          correctedValue: new Date("2026-04-18T09:00:00Z"),
          reason: "Self-approval-after-promotion attempt",
        });

        // Promoted to SUPER_ADMIN, which on its own would face no hierarchy minimum at all.
        await db
          .update(schema.companyMemberships)
          .set({ role: "SUPER_ADMIN" })
          .where(and(eq(schema.companyMemberships.userId, userId), eq(schema.companyMemberships.companyId, companyAId)));
        const promotedCtx = ctxFor({ role: "SUPER_ADMIN", userId, employeeId: null });

        // Still blocked: the check is requestedByUserId === ctx.userId, never role-based.
        await expect(svc.approveCorrection(promotedCtx, correction.id)).rejects.toThrow(errors.SelfApprovalNotAllowedError);

        await db.delete(schema.users).where(eq(schema.users.id, userId));
      });
    });

    describe("visibility", () => {
      it("keeps company-scoped visibility unchanged: a user can see a correction in the queue even when canReview is false", async () => {
        const correction = await svc.requestCorrection(hrAdminRoleCtx, employeeAId, {
          workDate: "2026-04-19",
          fieldChanged: "CHECK_IN",
          correctedValue: new Date("2026-04-19T09:00:00Z"),
          reason: "HR_ADMIN request for visibility check",
        });

        // hrManagerRoleCtx cannot approve an HR_ADMIN's correction (insufficient hierarchy), but
        // must still see it in the company-scoped queue — visibility and approval are separate.
        const queue = await svc.listCompanyCorrections(hrManagerRoleCtx, "PENDING");
        const row = queue.find((c) => c.id === correction.id);
        expect(row).toBeDefined();
        expect(row!.canReview).toBe(false);

        // The requester's own view of the queue: self-approval also reports canReview: false.
        const ownQueue = await svc.listCompanyCorrections(hrAdminRoleCtx, "PENDING");
        const ownRow = ownQueue.find((c) => c.id === correction.id);
        expect(ownRow!.canReview).toBe(false);

        // A COMPANY_ADMIN, with sufficient hierarchy and not the requester, sees canReview: true.
        const adminQueue = await svc.listCompanyCorrections(ctx, "PENDING");
        const adminRow = adminQueue.find((c) => c.id === correction.id);
        expect(adminRow!.canReview).toBe(true);

        await svc.approveCorrection(ctx, correction.id);
      });
    });
  });

  // F-01 — a stored daily record must never contradict the attendance state behind it, a read must never
  // write one, and every writer takes the same per-(employee, work date) lock.
  describe("daily record consistency", () => {
    let consistencyScheduleId: string;
    let seq = 0;

    beforeAll(async () => {
      const schedule = await workforceSvc.createWorkSchedule(ctx, { name: `AttConsistency-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      consistencyScheduleId = schedule.id;
    });

    async function newScheduledEmployee() {
      seq += 1;
      const employee = await employeeService.createEmployee(ctx, {
        firstName: "Consistency",
        lastName: `E${seq}-${Date.now()}`,
        workEmail: `att-consistency-${seq}-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: consistencyScheduleId, effectiveFrom: ASSIGNMENT_START });
      return employee.id;
    }

    async function storedRecord(employeeId: string, workDate: string) {
      return db.query.attendanceDailyRecords.findFirst({
        where: and(eq(schema.attendanceDailyRecords.employeeId, employeeId), eq(schema.attendanceDailyRecords.workDate, workDate)),
      });
    }

    const at = (iso: string) => vi.setSystemTime(new Date(iso));

    it("1. GET before check-in, then check-in: no daily row exists at any point until check-out", async () => {
      const id = await newScheduledEmployee();
      const D = "2026-07-01";

      at(`${D}T08:00:00Z`);
      const before = await svc.getAttendanceDay(ctx, id, D);
      expect(before.record.id).toBeNull();
      expect(await storedRecord(id, D)).toBeUndefined();

      at(`${D}T09:00:00Z`);
      await svc.checkIn(ctx, id);
      expect(await storedRecord(id, D)).toBeUndefined(); // check-in does not create a row

      at(`${D}T10:00:00Z`);
      const working = await svc.getAttendanceDay(ctx, id, D);
      expect(working.record.id).toBeNull(); // still provisional, never persisted by the read
      expect(working.record.sessionCount).toBe(1);
      expect(await storedRecord(id, D)).toBeUndefined();

      at(`${D}T18:00:00Z`);
      await svc.checkOut(ctx, id);
      const final = await storedRecord(id, D);
      expect(final?.status).toBe("PRESENT");
      expect(final?.sessionCount).toBe(1);
    });

    it("2. an existing HR-created row is refreshed by check-in (never left as ABSENT)", async () => {
      const id = await newScheduledEmployee();
      const D = "2026-07-02";

      at(`${D}T08:00:00Z`);
      const early = await svc.recalculateDailyRecord(ctx, id, D);
      expect(early.status).toBe("ABSENT");
      expect(early.sessionCount).toBe(0);

      at(`${D}T09:00:00Z`);
      await svc.checkIn(ctx, id);
      const refreshed = await storedRecord(id, D);
      expect(refreshed?.sessionCount).toBe(1);
      expect(refreshed?.status).toBe("INCOMPLETE");
      expect(refreshed?.firstCheckInAt?.toISOString()).toBe(`${D}T09:00:00.000Z`);

      at(`${D}T18:00:00Z`);
      await svc.checkOut(ctx, id);
    });

    it("3. break start/end keep an existing row consistent (and create none when there is none)", async () => {
      const withRow = await newScheduledEmployee();
      const withoutRow = await newScheduledEmployee();
      const D = "2026-07-03";

      at(`${D}T08:00:00Z`);
      await svc.recalculateDailyRecord(ctx, withRow, D);
      at(`${D}T09:00:00Z`);
      await svc.checkIn(ctx, withRow);
      await svc.checkIn(ctx, withoutRow);

      at(`${D}T13:00:00Z`);
      await svc.startBreak(ctx, withRow);
      await svc.startBreak(ctx, withoutRow);
      expect((await storedRecord(withRow, D))?.breakMinutes).toBe(0); // open break is not counted yet

      at(`${D}T13:30:00Z`);
      await svc.endBreak(ctx, withRow);
      await svc.endBreak(ctx, withoutRow);
      const row = await storedRecord(withRow, D);
      expect(row?.breakMinutes).toBe(30);
      expect(row?.sessionCount).toBe(1);
      expect(await storedRecord(withoutRow, D)).toBeUndefined();

      at(`${D}T18:00:00Z`);
      await svc.checkOut(ctx, withRow);
      await svc.checkOut(ctx, withoutRow);
      expect((await storedRecord(withRow, D))?.workedMinutes).toBe(510);
      expect((await storedRecord(withoutRow, D))?.workedMinutes).toBe(510);
    });

    it("4. session 1 closes, session 2 checks in and stays open: the record is not left as stale PRESENT", async () => {
      const id = await newScheduledEmployee();
      const D = "2026-07-04";

      at(`${D}T09:00:00Z`);
      await svc.checkIn(ctx, id);
      at(`${D}T12:00:00Z`);
      await svc.checkOut(ctx, id);
      expect((await storedRecord(id, D))?.status).toBe("PRESENT");

      at(`${D}T13:00:00Z`);
      await svc.checkIn(ctx, id); // same work date, still open
      const row = await storedRecord(id, D);
      expect(row?.sessionCount).toBe(2);
      expect(row?.status).toBe("INCOMPLETE");
      expect(row?.workedMinutes).toBeNull();

      at(`${D}T17:00:00Z`);
      await svc.checkOut(ctx, id);
      expect((await storedRecord(id, D))?.status).not.toBe("INCOMPLETE");
    });

    it("5. a forgotten check-out leaves no premature row, and the scheduled job later materializes INCOMPLETE", async () => {
      const id = await newScheduledEmployee();
      const D = "2026-07-05";
      const auto = await import("../processing/attendance-auto-processing.service");

      at(`${D}T09:00:00Z`);
      await svc.checkIn(ctx, id);
      at(`${D}T10:00:00Z`);
      await svc.getAttendanceDay(ctx, id, D);
      expect(await storedRecord(id, D)).toBeUndefined();

      at(`${D}T23:30:00Z`);
      await auto.processCompanyWorkDate(companyAId, D, "SCHEDULED");
      const row = await storedRecord(id, D);
      expect(row?.status).toBe("INCOMPLETE");
      expect(row?.sessionCount).toBe(1);
      expect(row?.workedMinutes).toBeNull();
    });

    it("6. a next-day check-in refreshes the abandoned session's existing record (and creates none for either day)", async () => {
      const id = await newScheduledEmployee();
      const D1 = "2026-07-06";
      const D2 = "2026-07-07";

      at(`${D1}T09:00:00Z`);
      await svc.checkIn(ctx, id); // forgotten check-out
      at(`${D1}T20:00:00Z`);
      const hr = await svc.recalculateDailyRecord(ctx, id, D1);
      expect(hr.status).toBe("INCOMPLETE");
      expect(hr.calculatedAt.toISOString()).toBe(`${D1}T20:00:00.000Z`);

      at(`${D2}T09:00:00Z`);
      await svc.checkIn(ctx, id); // abandons D1's session
      const refreshed = await storedRecord(id, D1);
      expect(refreshed?.calculatedAt.toISOString()).toBe(`${D2}T09:00:00.000Z`); // recalculated by the abandon
      expect(await storedRecord(id, D2)).toBeUndefined(); // nothing created for the new day

      at(`${D2}T18:00:00Z`);
      await svc.checkOut(ctx, id);
    });

    it("6b. abandoning a session whose month is CLOSED leaves its existing record untouched", async () => {
      const id = await newScheduledEmployee();
      const D1 = "2026-08-31";
      const D2 = "2026-09-01";

      at(`${D1}T09:00:00Z`);
      await svc.checkIn(ctx, id);
      at(`${D1}T20:00:00Z`);
      await svc.recalculateDailyRecord(ctx, id, D1);
      // A closed period can't coexist with an OPEN session through the service (close is refused), so
      // freeze the month directly: this is the "preserve closed-period behaviour" edge.
      await db.insert(schema.attendancePeriods).values({ companyId: companyAId, periodMonth: "2026-08", status: "CLOSED" }).onConflictDoUpdate({
        target: [schema.attendancePeriods.companyId, schema.attendancePeriods.periodMonth],
        set: { status: "CLOSED" },
      });
      try {
        at(`${D2}T09:00:00Z`);
        await svc.checkIn(ctx, id);
        expect((await storedRecord(id, D1))?.calculatedAt.toISOString()).toBe(`${D1}T20:00:00.000Z`);
      } finally {
        await db
          .update(schema.attendancePeriods)
          .set({ status: "OPEN" })
          .where(and(eq(schema.attendancePeriods.companyId, companyAId), eq(schema.attendancePeriods.periodMonth, "2026-08")));
      }
      at(`${D2}T18:00:00Z`);
      await svc.checkOut(ctx, id);
    });

    it("7. manual recalculation after check-in reflects the open session", async () => {
      const id = await newScheduledEmployee();
      const D = "2026-07-08";

      at(`${D}T09:00:00Z`);
      await svc.checkIn(ctx, id);
      at(`${D}T11:00:00Z`);
      const record = await svc.recalculateDailyRecord(ctx, id, D);
      expect(record.status).toBe("INCOMPLETE");
      expect(record.sessionCount).toBe(1);
      expect((await storedRecord(id, D))?.id).toBe(record.id);

      at(`${D}T18:00:00Z`);
      await svc.checkOut(ctx, id);
    });

    it("8. correction approval after check-in creates and calculates the record", async () => {
      const id = await newScheduledEmployee();
      const D = "2026-07-09";

      at(`${D}T09:00:00Z`);
      await svc.checkIn(ctx, id); // forgot to check out
      expect(await storedRecord(id, D)).toBeUndefined();

      at(`${D}T23:30:00Z`); // a corrected time must already have happened
      const correction = await svc.requestCorrection(ctx, id, {
        workDate: D,
        fieldChanged: "CHECK_OUT",
        correctedValue: new Date(`${D}T18:00:00Z`),
        reason: "Forgot to check out",
      });
      await svc.approveCorrection(ctxReviewer, correction.id, { reviewNote: "ok" });

      const row = await storedRecord(id, D);
      expect(row?.status).toBe("PRESENT");
      expect(row?.workedMinutes).toBe(540);
    });

    it("9. + 10. a check-out whose calculation fails rolls the whole punch back, and the retry succeeds", async () => {
      const id = await newScheduledEmployee();
      const D = "2026-07-11";
      const repo = await import("../repository");

      at(`${D}T09:00:00Z`);
      await svc.checkIn(ctx, id);
      at(`${D}T18:00:00Z`);

      const spy = vi.spyOn(repo.attendanceDailyRecordRepository, "upsert").mockRejectedValueOnce(new Error("simulated calculation write failure"));
      await expect(svc.checkOut(ctx, id)).rejects.toThrow("simulated calculation write failure");
      spy.mockRestore();

      // Complete rollback: session still OPEN, no CHECK_OUT event, no daily record.
      const { session } = await svc.getCurrentSession(ctx, id);
      expect(session?.status).toBe("OPEN");
      expect(session?.checkOutAt).toBeNull();
      const events = await db.query.attendanceEvents.findMany({ where: eq(schema.attendanceEvents.employeeId, id) });
      expect(events.map((e) => e.eventType)).toEqual(["CHECK_IN"]);
      expect(await storedRecord(id, D)).toBeUndefined();

      // Retry: succeeds and leaves a consistent record.
      const closed = await svc.checkOut(ctx, id);
      expect(closed.status).toBe("CLOSED");
      const row = await storedRecord(id, D);
      expect(row?.status).toBe("PRESENT");
      expect(row?.sessionCount).toBe(1);
    });

    it("concurrency: check-in racing a recalculation always leaves the stored row consistent with the session", async () => {
      const id = await newScheduledEmployee();
      for (const D of ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"]) {
        at(`${D}T08:00:00Z`);
        await svc.recalculateDailyRecord(ctx, id, D); // an existing (ABSENT) row
        at(`${D}T09:00:00Z`);
        const results = await Promise.allSettled([svc.checkIn(ctx, id), svc.recalculateDailyRecord(ctx, id, D)]);
        expect(results.every((r) => r.status === "fulfilled")).toBe(true);

        const row = await storedRecord(id, D);
        expect(row?.sessionCount).toBe(1);
        expect(row?.status).toBe("INCOMPLETE");

        at(`${D}T18:00:00Z`);
        await svc.checkOut(ctx, id);
      }
    });

    it("concurrency: a GET racing a check-in / check-out can never persist or overwrite anything", async () => {
      const id = await newScheduledEmployee();
      const D = "2026-07-20";

      at(`${D}T09:00:00Z`);
      await Promise.all([svc.checkIn(ctx, id), svc.getAttendanceDay(ctx, id, D), svc.getAttendanceDay(ctx, id, D)]);
      expect(await storedRecord(id, D)).toBeUndefined(); // the GETs wrote nothing, whatever the interleaving

      at(`${D}T18:00:00Z`);
      await Promise.all([svc.checkOut(ctx, id), svc.getAttendanceDay(ctx, id, D), svc.getAttendanceDay(ctx, id, D), svc.getAttendanceDay(ctx, id, D)]);
      const row = await storedRecord(id, D);
      expect(row?.status).toBe("PRESENT"); // not overwritten by a GET's stale ABSENT
      expect(row?.sessionCount).toBe(1);
      expect(row?.workedMinutes).toBe(540);
    });
  });

  // F-05 - a session must never be left stranded in OPEN with no way out.
  describe("stranded sessions (F-05)", () => {
    let scheduleId: string;
    let seq = 0;
    let periodSvc: typeof import("../periods/attendance-period.service");

    beforeAll(async () => {
      periodSvc = await import("../periods/attendance-period.service");
      const schedule = await workforceSvc.createWorkSchedule(ctx, { name: `AttStranded-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      scheduleId = schedule.id;
    });

    async function newScheduledEmployee() {
      seq += 1;
      const employee = await employeeService.createEmployee(ctx, {
        firstName: "Stranded",
        lastName: `E${seq}-${Date.now()}`,
        workEmail: `att-stranded-${seq}-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: scheduleId, effectiveFrom: ASSIGNMENT_START });
      return employee.id;
    }

    const at = (iso: string) => vi.setSystemTime(new Date(iso));
    const sessionsOf = (employeeId: string) =>
      db.query.attendanceOpenSessions.findMany({ where: eq(schema.attendanceOpenSessions.employeeId, employeeId), orderBy: (t, { asc }) => [asc(t.checkInAt)] });
    const abandonAudits = async (sessionId: string) =>
      (await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.entityId, sessionId) })).filter((l) => l.action === "attendance.session.abandon");

    it("an approved missing-check-out correction closes the OPEN session: period can close, recalculation stays valid, and the employee can check in again", async () => {
      const id = await newScheduledEmployee();
      const D = "2026-11-03";

      at(`${D}T09:00:00Z`);
      const open = await svc.checkIn(ctx, id); // forgets to check out
      at(`${D}T23:30:00Z`);
      const correction = await svc.requestCorrection(ctx, id, { workDate: D, fieldChanged: "CHECK_OUT", correctedValue: new Date(`${D}T18:00:00Z`), reason: "Forgot" });

      // Still OPEN (and blocking the period) until the correction is approved.
      await expect(periodSvc.closeAttendancePeriod(ctx, "2026-11")).rejects.toThrow();

      await svc.approveCorrection(ctxReviewer, correction.id, { reviewNote: "ok" });

      const [session] = await sessionsOf(id);
      expect(session!.id).toBe(open.id);
      expect(session!.status).toBe("CLOSED");
      expect(session!.checkOutAt?.toISOString()).toBe(`${D}T18:00:00.000Z`);
      // No synthetic CHECK_OUT event is fabricated; the correction row is the record.
      const events = await db.query.attendanceEvents.findMany({ where: eq(schema.attendanceEvents.employeeId, id) });
      expect(events.map((e) => e.eventType)).toEqual(["CHECK_IN"]);

      expect((await svc.getCurrentSession(ctx, id)).session).toBeNull();
      expect((await svc.recalculateDailyRecord(ctx, id, D)).workedMinutes).toBe(540); // still resolves the correction's target
      const row = await db.query.attendanceDailyRecords.findFirst({ where: and(eq(schema.attendanceDailyRecords.employeeId, id), eq(schema.attendanceDailyRecords.workDate, D)) });
      expect(row?.status).toBe("PRESENT");

      // The employee is no longer locked out of the same work date.
      at(`${D}T19:00:00Z`);
      const second = await svc.checkIn(ctx, id);
      expect(second.status).toBe("OPEN");
      at(`${D}T20:00:00Z`);
      await svc.checkOut(ctx, id);

      // And the month is closable once nothing else is open in it (this test's employee only).
      const preview = await periodSvc.previewAttendancePeriodClose(ctx, "2026-11");
      expect(preview.openSessionCount).toBe(0);
    });

    it("an employee who has LEFT with a stranded session can be resolved by HR through the correction workflow", async () => {
      const id = await newScheduledEmployee();
      const D = "2026-11-04";

      at(`${D}T09:00:00Z`);
      await svc.checkIn(ctx, id);
      await employeeService.changeEmployeeStatus(ctx, id, "TERMINATED");
      await expect(svc.checkIn(ctx, id)).rejects.toThrow(); // cannot start a new session...

      // ...and previously nothing could ever close the old one. HR requests, a different user approves.
      at(`${D}T23:30:00Z`);
      const correction = await svc.requestCorrection(ctxReviewer, id, { workDate: D, fieldChanged: "CHECK_OUT", correctedValue: new Date(`${D}T17:00:00Z`), reason: "Left; closing session" });
      await svc.approveCorrection(ctx, correction.id, { reviewNote: "confirmed" });

      const [session] = await sessionsOf(id);
      expect(session!.status).toBe("CLOSED");
      expect((await periodSvc.previewAttendancePeriodClose(ctx, "2026-11")).openSessionCount).toBe(0);
    });

    it("a previous-day OPEN session is abandoned exactly once by the next-day check-in, even with concurrent check-ins; only one OPEN session ever exists", async () => {
      const id = await newScheduledEmployee();
      const D1 = "2026-11-05";
      const D2 = "2026-11-06";

      at(`${D1}T09:00:00Z`);
      const stale = await svc.checkIn(ctx, id);

      at(`${D2}T09:00:00Z`);
      const results = await Promise.allSettled([svc.checkIn(ctx, id), svc.checkIn(ctx, id), svc.checkIn(ctx, id)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((r) => r.status === "rejected")) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(errors.AlreadyCheckedInError);
      }

      const sessions = await sessionsOf(id);
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((x) => x.status === "OPEN")).toHaveLength(1);
      expect(sessions.find((x) => x.id === stale.id)?.status).toBe("ABANDONED");
      expect(await abandonAudits(stale.id)).toHaveLength(1);

      at(`${D2}T18:00:00Z`);
      await svc.checkOut(ctx, id);
    });

    it("a check-in that fails part-way (daily-record refresh) leaves NO partial state: old session still OPEN, nothing created, no abandon audit - and the retry works", async () => {
      const id = await newScheduledEmployee();
      const D1 = "2026-11-09";
      const D2 = "2026-11-10";
      const repo = await import("../repository");

      at(`${D1}T09:00:00Z`);
      const stale = await svc.checkIn(ctx, id); // never checked out
      at(`${D2}T08:00:00Z`);
      await svc.recalculateDailyRecord(ctx, id, D2); // an existing row => the check-in must refresh it

      at(`${D2}T09:00:00Z`);
      const spy = vi.spyOn(repo.attendanceDailyRecordRepository, "upsert").mockRejectedValueOnce(new Error("simulated refresh failure"));
      await expect(svc.checkIn(ctx, id)).rejects.toThrow("simulated refresh failure");
      spy.mockRestore();

      const afterFailure = await sessionsOf(id);
      expect(afterFailure).toHaveLength(1);
      expect(afterFailure[0]!.id).toBe(stale.id);
      expect(afterFailure[0]!.status).toBe("OPEN"); // NOT abandoned: the abandon rolled back with the transaction
      expect(await abandonAudits(stale.id)).toHaveLength(0);
      const events = await db.query.attendanceEvents.findMany({ where: eq(schema.attendanceEvents.employeeId, id) });
      expect(events).toHaveLength(1);

      const retry = await svc.checkIn(ctx, id);
      expect(retry.status).toBe("OPEN");
      const afterRetry = await sessionsOf(id);
      expect(afterRetry.map((x) => x.status)).toEqual(["ABANDONED", "OPEN"]);
      expect(await abandonAudits(stale.id)).toHaveLength(1);

      at(`${D2}T18:00:00Z`);
      await svc.checkOut(ctx, id);
    });

    it("an abandoned previous-month session no longer blocks that month's period close", async () => {
      const id = await newScheduledEmployee();
      at("2026-12-31T09:00:00Z");
      await svc.checkIn(ctx, id);
      expect((await periodSvc.previewAttendancePeriodClose(ctx, "2026-12")).openSessionCount).toBeGreaterThanOrEqual(1);

      at("2027-01-04T09:00:00Z");
      await svc.checkIn(ctx, id); // abandons the Dec-31 session
      const dec = await db.query.attendanceOpenSessions.findMany({
        where: and(eq(schema.attendanceOpenSessions.employeeId, id), eq(schema.attendanceOpenSessions.workDate, "2026-12-31")),
      });
      expect(dec[0]!.status).toBe("ABANDONED");
      at("2027-01-04T18:00:00Z");
      await svc.checkOut(ctx, id);
    });
  });

  // F-07 - the server decides what "today" is (in the employee's own timezone); future attendance is never
  // written, and historical HR operations keep working.
  describe("date boundaries (F-07)", () => {
    let scheduleId: string;
    let auckland: string; // branch id
    let seq = 0;

    beforeAll(async () => {
      const schedule = await workforceSvc.createWorkSchedule(ctx, { name: `AttDates-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      scheduleId = schedule.id;
      const [branch] = await db
        .insert(schema.branches)
        .values({ companyId: companyAId, name: "Auckland", code: `ATT_AKL_${Date.now()}`, timezone: "Pacific/Auckland" })
        .returning();
      auckland = branch!.id;
    });

    async function newEmployee(overrides: { locationId?: string; dateOfJoining?: string } = {}) {
      seq += 1;
      const employee = await employeeService.createEmployee(ctx, {
        firstName: "Dates",
        lastName: `E${seq}-${Date.now()}`,
        workEmail: `att-dates-${seq}-${Date.now()}@test.local`,
        dateOfJoining: overrides.dateOfJoining ?? "2020-01-01",
        locationId: overrides.locationId ?? branchId,
      });
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: scheduleId, effectiveFrom: ASSIGNMENT_START });
      return employee.id;
    }

    const at = (iso: string) => vi.setSystemTime(new Date(iso));
    const recordCount = async (employeeId: string) =>
      (await db.query.attendanceDailyRecords.findMany({ where: eq(schema.attendanceDailyRecords.employeeId, employeeId) })).length;
    const correctionCount = async (employeeId: string) =>
      (await db.query.attendanceCorrections.findMany({ where: eq(schema.attendanceCorrections.employeeId, employeeId) })).length;

    it("today and yesterday can be recalculated (legitimate historical HR operations)", async () => {
      const id = await newEmployee();
      at("2026-07-21T10:00:00Z");
      expect((await svc.recalculateDailyRecord(ctx, id, "2026-07-21")).workDate).toBe("2026-07-21"); // today
      expect((await svc.recalculateDailyRecord(ctx, id, "2026-07-20")).workDate).toBe("2026-07-20"); // yesterday
      expect((await svc.recalculateDailyRecord(ctx, id, "2025-01-06")).workDate).toBe("2025-01-06"); // long ago
      expect(await recordCount(id)).toBe(3);
    });

    it("a future date is rejected by recalculation and Process Day, and nothing is persisted", async () => {
      const id = await newEmployee();
      const processing = await import("../processing/attendance-processing.service");
      at("2026-07-21T10:00:00Z");

      await expect(svc.recalculateDailyRecord(ctx, id, "2026-07-22")).rejects.toBeInstanceOf(errors.InvalidAttendanceDateError);
      await expect(svc.recalculateDailyRecord(ctx, id, "2099-01-01")).rejects.toBeInstanceOf(errors.InvalidAttendanceDateError);
      await expect(processing.processEmployeeAttendanceDay(ctx, { employeeId: id, workDate: "2026-07-22" })).rejects.toBeInstanceOf(errors.InvalidAttendanceDateError);
      await expect(processing.processCompanyAttendanceDay(ctx, { workDate: "2026-07-22" })).rejects.toBeInstanceOf(errors.InvalidAttendanceDateError);

      expect(await recordCount(id)).toBe(0);
      const futureRows = await db.query.attendanceDailyRecords.findMany({
        where: and(eq(schema.attendanceDailyRecords.companyId, companyAId), eq(schema.attendanceDailyRecords.workDate, "2026-07-22")),
      });
      expect(futureRows).toHaveLength(0); // Process Day wrote nothing for anyone in the company
    });

    it("a correction cannot name a future work date or a future time; a valid historical one is accepted", async () => {
      const id = await newEmployee();
      at("2026-07-21T12:00:00Z");

      await expect(
        svc.requestCorrection(ctx, id, { workDate: "2026-07-22", fieldChanged: "CHECK_IN", correctedValue: new Date("2026-07-22T09:00:00Z"), reason: "future day" }),
      ).rejects.toBeInstanceOf(errors.InvalidAttendanceDateError);
      await expect(
        svc.requestCorrection(ctx, id, { workDate: "2026-07-21", fieldChanged: "CHECK_IN", correctedValue: new Date("2026-07-21T15:00:00Z"), reason: "later today" }),
      ).rejects.toBeInstanceOf(errors.InvalidAttendanceDateError);
      expect(await correctionCount(id)).toBe(0);

      const ok = await svc.requestCorrection(ctx, id, { workDate: "2026-07-20", fieldChanged: "CHECK_IN", correctedValue: new Date("2026-07-20T09:10:00Z"), reason: "forgot yesterday" });
      expect(ok.status).toBe("PENDING");
      expect(await correctionCount(id)).toBe(1);
    });

    it("TIMEZONE BOUNDARY: 'today' is the employee's own local date - Auckland is already on the 22nd while UTC is still the 21st", async () => {
      const utcEmployee = await newEmployee();
      const aucklandEmployee = await newEmployee({ locationId: auckland });
      at("2026-07-21T20:00:00Z"); // 08:00 on 22 July in Auckland (UTC+12)

      expect((await svc.recalculateDailyRecord(ctx, aucklandEmployee, "2026-07-22")).workDate).toBe("2026-07-22");
      await expect(svc.recalculateDailyRecord(ctx, utcEmployee, "2026-07-22")).rejects.toBeInstanceOf(errors.InvalidAttendanceDateError);
      // The 23rd has not started anywhere in either timezone.
      await expect(svc.recalculateDailyRecord(ctx, aucklandEmployee, "2026-07-23")).rejects.toBeInstanceOf(errors.InvalidAttendanceDateError);
      await expect(svc.recalculateDailyRecord(ctx, utcEmployee, "2026-07-23")).rejects.toBeInstanceOf(errors.InvalidAttendanceDateError);
    });

    it("malformed and impossible dates are rejected at the service boundary too (never reach a query)", async () => {
      const id = await newEmployee();
      const processing = await import("../processing/attendance-processing.service");
      at("2026-07-21T10:00:00Z");
      for (const bad of ["2026-02-31", "2026-13-01", "9999-12-31", "07/21/2026", ""]) {
        await expect(svc.recalculateDailyRecord(ctx, id, bad)).rejects.toBeInstanceOf(errors.InvalidAttendanceDateError);
        await expect(svc.getAttendanceDay(ctx, id, bad)).rejects.toBeInstanceOf(errors.InvalidAttendanceDateError);
        await expect(processing.processEmployeeAttendanceDay(ctx, { employeeId: id, workDate: bad })).rejects.toBeInstanceOf(errors.InvalidAttendanceDateError);
      }
      expect(await recordCount(id)).toBe(0);
    });

    it("a date before the employee joined cannot be calculated", async () => {
      const id = await newEmployee({ dateOfJoining: "2026-07-01" });
      at("2026-07-21T10:00:00Z");
      await expect(svc.recalculateDailyRecord(ctx, id, "2026-06-30")).rejects.toBeInstanceOf(errors.InvalidAttendanceDateError);
      expect((await svc.recalculateDailyRecord(ctx, id, "2026-07-01")).workDate).toBe("2026-07-01");
    });

    it("a client-supplied date/time on a punch is ignored: the server clock and the employee's timezone decide the work date", async () => {
      const id = await newEmployee();
      at("2026-07-21T09:00:00Z");
      const smuggled = { workDate: "2099-01-01", occurredAt: "2099-01-01T09:00:00Z", checkInAt: new Date("2099-01-01T09:00:00Z") } as unknown as Parameters<typeof svc.checkIn>[2];
      const session = await svc.checkIn(ctx, id, smuggled);
      expect(session.workDate).toBe("2026-07-21");
      expect(session.checkInAt.toISOString()).toBe("2026-07-21T09:00:00.000Z");
      const future = await db.query.attendanceOpenSessions.findMany({
        where: and(eq(schema.attendanceOpenSessions.employeeId, id), eq(schema.attendanceOpenSessions.workDate, "2099-01-01")),
      });
      expect(future).toHaveLength(0);
      at("2026-07-21T18:00:00Z");
      await svc.checkOut(ctx, id);
    });
  });

  // F-09 / F-19 / F-20 - a retried or repeated request must never produce a second business effect.
  describe("duplicate requests and idempotency (F-09, F-19, F-20)", () => {
    let scheduleId: string;
    let seq = 0;

    beforeAll(async () => {
      const schedule = await workforceSvc.createWorkSchedule(ctx, { name: `AttIdem-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      scheduleId = schedule.id;
    });

    async function newScheduledEmployee() {
      seq += 1;
      const employee = await employeeService.createEmployee(ctx, {
        firstName: "Idem",
        lastName: `E${seq}-${Date.now()}`,
        workEmail: `att-idem-${seq}-${Date.now()}@test.local`,
        dateOfJoining: "2020-01-01",
        locationId: branchId,
      });
      await workforceSvc.assignEmployeeSchedule(ctx, employee.id, { workScheduleId: scheduleId, effectiveFrom: ASSIGNMENT_START });
      return employee.id;
    }

    const at = (iso: string) => vi.setSystemTime(new Date(iso));
    const eventsOf = (employeeId: string) => db.query.attendanceEvents.findMany({ where: eq(schema.attendanceEvents.employeeId, employeeId), orderBy: (t, { asc }) => [asc(t.occurredAt)] });
    const sessionsOf = (employeeId: string) => db.query.attendanceOpenSessions.findMany({ where: eq(schema.attendanceOpenSessions.employeeId, employeeId) });
    const correctionsOf = (employeeId: string) => db.query.attendanceCorrections.findMany({ where: eq(schema.attendanceCorrections.employeeId, employeeId) });
    const auditCount = async (action: string, entityId: string) =>
      (await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.entityId, entityId) })).filter((l) => l.action === action).length;

    // ------------------------------------------------------------------ F-09 duplicate corrections
    describe("duplicate corrections (F-09)", () => {
      const request = (id: string, D: string, overrides: Partial<Parameters<typeof svc.requestCorrection>[2]> = {}, who = ctx) =>
        svc.requestCorrection(who, id, { workDate: D, fieldChanged: "CHECK_IN", correctedValue: new Date(`${D}T09:10:00Z`), reason: "Forgot to check in", ...overrides });

      it("the SAME request repeated (double-click / retry) returns the original: one row, one audit entry", async () => {
        const id = await newScheduledEmployee();
        const D = "2026-08-03";
        at(`${D}T20:00:00Z`);

        const first = await request(id, D);
        const second = await request(id, D); // a retry of the identical request
        expect(second.id).toBe(first.id);
        expect(await correctionsOf(id)).toHaveLength(1);
        expect(await auditCount("attendance.correction.create", first.id)).toBe(1);
      });

      it("concurrent identical requests produce exactly one correction (no double insert), and all callers get that one", async () => {
        const id = await newScheduledEmployee();
        const D = "2026-08-04";
        at(`${D}T20:00:00Z`);

        const results = await Promise.allSettled(Array.from({ length: 5 }, () => request(id, D)));
        expect(results.every((r) => r.status === "fulfilled")).toBe(true);
        const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id));
        expect(ids.size).toBe(1);

        const rows = await correctionsOf(id);
        expect(rows).toHaveLength(1);
        expect(await auditCount("attendance.correction.create", rows[0]!.id)).toBe(1);
      });

      it("concurrent requests with DIFFERENT values for the same target: exactly one wins, the other is a genuine conflict", async () => {
        const id = await newScheduledEmployee();
        const D = "2026-08-05";
        at(`${D}T20:00:00Z`);

        const results = await Promise.allSettled([
          request(id, D, { correctedValue: new Date(`${D}T09:10:00Z`) }),
          request(id, D, { correctedValue: new Date(`${D}T09:20:00Z`) }),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        expect(rejected.reason).toBeInstanceOf(errors.ConflictingCorrectionError);
        expect(await correctionsOf(id)).toHaveLength(1);
      });

      it("a repeat from a DIFFERENT requester, or after the first was reviewed, is still a conflict (not silently merged)", async () => {
        const id = await newScheduledEmployee();
        const D = "2026-08-06";
        at(`${D}T20:00:00Z`);

        const first = await request(id, D);
        await expect(request(id, D, {}, ctxReviewer)).rejects.toBeInstanceOf(errors.ConflictingCorrectionError); // other requester, same values
        await svc.approveCorrection(ctxReviewer, first.id);
        await expect(request(id, D)).rejects.toBeInstanceOf(errors.ConflictingCorrectionError); // already APPROVED
        expect(await correctionsOf(id)).toHaveLength(1);
      });

      it("genuinely different corrections for the same employee and day remain possible (different field / event), and a rejected one can be re-requested", async () => {
        const id = await newScheduledEmployee();
        const D = "2026-08-07";
        at(`${D}T09:20:00Z`);
        await svc.checkIn(ctx, id);
        at(`${D}T17:00:00Z`);
        await svc.checkOut(ctx, id);
        const events = await eventsOf(id);
        const checkInEvent = events.find((e) => e.eventType === "CHECK_IN")!;
        const checkOutEvent = events.find((e) => e.eventType === "CHECK_OUT")!;
        at(`${D}T20:00:00Z`);

        const a = await request(id, D, { eventId: checkInEvent.id, correctedValue: new Date(`${D}T09:00:00Z`), reason: "arrived earlier" });
        const b = await request(id, D, { fieldChanged: "CHECK_OUT", eventId: checkOutEvent.id, correctedValue: new Date(`${D}T18:00:00Z`), reason: "left later" });
        expect(a.id).not.toBe(b.id);
        expect(await correctionsOf(id)).toHaveLength(2);

        await svc.rejectCorrection(ctxReviewer, a.id, { reviewNote: "no" });
        const again = await request(id, D, { eventId: checkInEvent.id, correctedValue: new Date(`${D}T09:05:00Z`), reason: "arrived earlier, corrected" });
        expect(again.id).not.toBe(a.id);
        expect(await correctionsOf(id)).toHaveLength(3);
      });

      it("a correction approval racing the employee's own check-out leaves one consistent outcome: session closed, record consistent, no deadlock", async () => {
        const id = await newScheduledEmployee();
        const D = "2026-08-10";
        at(`${D}T09:00:00Z`);
        await svc.checkIn(ctx, id);
        at(`${D}T19:00:00Z`);
        const correction = await request(id, D, { fieldChanged: "CHECK_OUT", correctedValue: new Date(`${D}T18:00:00Z`), reason: "forgot" });

        const results = await Promise.allSettled([svc.approveCorrection(ctxReviewer, correction.id), svc.checkOut(ctx, id)]);
        expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);

        const [session] = await sessionsOf(id);
        expect(session!.status).toBe("CLOSED");
        const row = await db.query.attendanceDailyRecords.findFirst({ where: and(eq(schema.attendanceDailyRecords.employeeId, id), eq(schema.attendanceDailyRecords.workDate, D)) });
        expect(row?.status).not.toBe("INCOMPLETE");
        expect(row?.sessionCount).toBe(1);
      });
    });

    // ------------------------------------------------------------------ F-19 / F-20 idempotency
    describe("idempotency keys (F-19, F-20)", () => {
      it("a retry with the same key returns the original session - one session, one event, one audit entry", async () => {
        const id = await newScheduledEmployee();
        const D = "2026-08-11";
        const key = crypto.randomUUID();
        at(`${D}T09:00:00Z`);

        const first = await svc.checkIn(ctx, id, { idempotencyKey: key });
        at(`${D}T09:00:05Z`);
        const retry = await svc.checkIn(ctx, id, { idempotencyKey: key });
        expect(retry.id).toBe(first.id);
        expect(await sessionsOf(id)).toHaveLength(1);
        expect((await eventsOf(id)).filter((e) => e.eventType === "CHECK_IN")).toHaveLength(1);
        expect(await auditCount("attendance.check_in", first.id)).toBe(1);

        // Even after the session is closed, the retry of the original request still resolves to it.
        at(`${D}T18:00:00Z`);
        await svc.checkOut(ctx, id);
        expect((await svc.checkIn(ctx, id, { idempotencyKey: key })).id).toBe(first.id);
        expect(await sessionsOf(id)).toHaveLength(1);
      });

      it("the same key cannot be reused for a materially different action: it is refused, nothing is written", async () => {
        const id = await newScheduledEmployee();
        const D = "2026-08-12";
        const key = crypto.randomUUID();
        at(`${D}T09:00:00Z`);
        await svc.checkIn(ctx, id, { idempotencyKey: key });

        at(`${D}T12:00:00Z`);
        await expect(svc.checkOut(ctx, id, { idempotencyKey: key })).rejects.toBeInstanceOf(errors.IdempotencyKeyReuseError);
        await expect(svc.startBreak(ctx, id, { idempotencyKey: key })).rejects.toBeInstanceOf(errors.IdempotencyKeyReuseError);

        const [session] = await sessionsOf(id);
        expect(session!.status).toBe("OPEN"); // the check-out did NOT happen, and was not mistaken for the check-in's replay
        expect((await eventsOf(id)).map((e) => e.eventType)).toEqual(["CHECK_IN"]);

        at(`${D}T18:00:00Z`);
        await svc.checkOut(ctx, id, { idempotencyKey: crypto.randomUUID() }); // a fresh key works
      });

      it("concurrent requests with the same key: every caller gets the one original result (check-in and check-out)", async () => {
        const id = await newScheduledEmployee();
        const D = "2026-08-13";
        const inKey = crypto.randomUUID();
        const outKey = crypto.randomUUID();

        at(`${D}T09:00:00Z`);
        const ins = await Promise.allSettled([svc.checkIn(ctx, id, { idempotencyKey: inKey }), svc.checkIn(ctx, id, { idempotencyKey: inKey }), svc.checkIn(ctx, id, { idempotencyKey: inKey })]);
        expect(ins.every((r) => r.status === "fulfilled")).toBe(true);
        expect(new Set(ins.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id)).size).toBe(1);
        expect(await sessionsOf(id)).toHaveLength(1);
        expect((await eventsOf(id)).filter((e) => e.eventType === "CHECK_IN")).toHaveLength(1);

        at(`${D}T18:00:00Z`);
        const outs = await Promise.allSettled([svc.checkOut(ctx, id, { idempotencyKey: outKey }), svc.checkOut(ctx, id, { idempotencyKey: outKey }), svc.checkOut(ctx, id, { idempotencyKey: outKey })]);
        expect(outs.every((r) => r.status === "fulfilled")).toBe(true);
        expect(new Set(outs.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id)).size).toBe(1);
        expect((await eventsOf(id)).filter((e) => e.eventType === "CHECK_OUT")).toHaveLength(1);
        const [session] = await sessionsOf(id);
        expect(session!.status).toBe("CLOSED");
      });

      it("break retries with the same key return the same event (one row each)", async () => {
        const id = await newScheduledEmployee();
        const D = "2026-08-14";
        const startKey = crypto.randomUUID();
        const endKey = crypto.randomUUID();
        at(`${D}T09:00:00Z`);
        await svc.checkIn(ctx, id);
        at(`${D}T13:00:00Z`);
        const results = await Promise.all([svc.startBreak(ctx, id, { idempotencyKey: startKey }), svc.startBreak(ctx, id, { idempotencyKey: startKey })]);
        expect(results[0].id).toBe(results[1].id);
        at(`${D}T13:30:00Z`);
        const ends = await Promise.all([svc.endBreak(ctx, id, { idempotencyKey: endKey }), svc.endBreak(ctx, id, { idempotencyKey: endKey })]);
        expect(ends[0].id).toBe(ends[1].id);
        const types = (await eventsOf(id)).map((e) => e.eventType);
        expect(types.filter((t) => t === "BREAK_START")).toHaveLength(1);
        expect(types.filter((t) => t === "BREAK_END")).toHaveLength(1);
        at(`${D}T18:00:00Z`);
        await svc.checkOut(ctx, id);
      });

      it("a failed transaction leaves no key behind: the retry with the same key succeeds", async () => {
        const id = await newScheduledEmployee();
        const D = "2026-08-17";
        const key = crypto.randomUUID();
        const repo = await import("../repository");
        at(`${D}T09:00:00Z`);
        await svc.checkIn(ctx, id);
        at(`${D}T18:00:00Z`);

        const spy = vi.spyOn(repo.attendanceDailyRecordRepository, "upsert").mockRejectedValueOnce(new Error("simulated failure"));
        await expect(svc.checkOut(ctx, id, { idempotencyKey: key })).rejects.toThrow("simulated failure");
        spy.mockRestore();

        expect((await eventsOf(id)).filter((e) => e.idempotencyKey === key)).toHaveLength(0); // the failed attempt consumed nothing
        const closed = await svc.checkOut(ctx, id, { idempotencyKey: key });
        expect(closed.status).toBe("CLOSED");
        expect((await eventsOf(id)).filter((e) => e.idempotencyKey === key)).toHaveLength(1);
      });

      it("F-19: a punch refuses oversized client metadata (sourceMetadata) instead of storing it", async () => {
        const { attendanceActionSchema, SOURCE_METADATA_MAX_BYTES } = await import("@/validations/attendance");
        expect(attendanceActionSchema.safeParse({ sourceMetadata: { device: "web", note: "ok" } }).success).toBe(true);
        expect(attendanceActionSchema.safeParse({ sourceMetadata: { blob: "x".repeat(SOURCE_METADATA_MAX_BYTES) } }).success).toBe(false);
        expect(attendanceActionSchema.safeParse({}).success).toBe(true);
      });
    });
  });

  describe("recalculation", () => {
    it("recalculateDailyRecord recomputes and persists the same figures getAttendanceDay would compute", async () => {
      vi.setSystemTime(new Date("2026-06-10T09:00:00Z"));
      await svc.checkIn(ctx, employeeAId);
      vi.setSystemTime(new Date("2026-06-10T18:00:00Z"));
      await svc.checkOut(ctx, employeeAId);

      const record = await svc.recalculateDailyRecord(ctx, employeeAId, "2026-06-10");
      expect(record.status).toBe("PRESENT");
      expect(record.scheduledMinutes).toBe(540);
      expect(record.workedMinutes).toBe(540);
    });
  });

  describe("audit logging", () => {
    it("writes an audit log entry for check-in", async () => {
      vi.setSystemTime(new Date("2026-06-20T09:00:00Z"));
      const session = await svc.checkIn(ctx, employeeAId);
      vi.setSystemTime(new Date("2026-06-20T18:00:00Z"));
      await svc.checkOut(ctx, employeeAId);

      const logs = await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.entityId, session.id) });
      const actions = logs.map((l) => l.action);
      expect(actions).toContain("attendance.check_in");
      expect(actions).toContain("attendance.check_out");
    });
  });
});
