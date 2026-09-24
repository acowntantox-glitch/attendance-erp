import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
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
  let ctx: import("@/lib/auth/request-context").RequestContext;
  let ctxCompanyB: import("@/lib/auth/request-context").RequestContext;
  let ctxManager: import("@/lib/auth/request-context").RequestContext;

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
      await svc.startBreak(ctx, employeeAId);
      await expect(svc.checkOut(ctx, employeeAId)).rejects.toThrow(errors.OpenBreakExistsError);
      await svc.endBreak(ctx, employeeAId);
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

      const breakEvent = await svc.startBreak(callerCtx, other.id);
      expect(breakEvent.employeeId).toBe(caller.id);
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

      const approved = await svc.approveCorrection(ctx, correction.id, { reviewNote: "Confirmed with manager" });
      expect(approved.status).toBe("APPROVED");
      expect(approved.reviewedByUserId).toBe(adminUserId);

      await expect(svc.approveCorrection(ctx, correction.id)).rejects.toThrow(errors.CorrectionAlreadyReviewedError);
    });

    it("supports rejection", async () => {
      const correction = await svc.requestCorrection(ctx, employeeAId, {
        workDate: "2026-02-21",
        fieldChanged: "CHECK_IN",
        correctedValue: new Date("2026-02-21T09:00:00Z"),
        reason: "Requesting an adjustment",
      });
      const rejected = await svc.rejectCorrection(ctx, correction.id, { reviewNote: "Not enough evidence" });
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

    it("MANAGER can request a correction for any employee in the company but cannot approve or reject one", async () => {
      const correction = await svc.requestCorrection(ctxManager, employeeGraceId, {
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
      const [checkInEvent] = await db.query.attendanceEvents.findMany({
        where: eq(schema.attendanceEvents.sessionId, session.id),
      });

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

    it("an APPROVED missing-checkout correction recalculates the day (no longer INCOMPLETE); PENDING and REJECTED have no effect", async () => {
      vi.setSystemTime(new Date("2026-03-15T09:00:00Z"));
      await svc.checkIn(ctx, employeeGraceId);
      // Forgot to check out — the session stays OPEN.

      const before = await svc.getAttendanceDay(ctx, employeeGraceId, "2026-03-15");
      expect(before.record.status).toBe("INCOMPLETE");

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

      const approved = await svc.approveCorrection(ctx, correction.id, { reviewNote: "Confirmed via manual timesheet" });
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

      const correction = await svc.requestCorrection(ctx, employeeGraceId, {
        workDate: "2026-03-16",
        fieldChanged: "CHECK_OUT",
        correctedValue: new Date("2026-03-16T18:00:00Z"),
        reason: "Forgot to check out",
      });

      const rejected = await svc.rejectCorrection(ctx, correction.id, { reviewNote: "Insufficient evidence" });
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

      const [a, b] = await Promise.allSettled([svc.approveCorrection(ctx, correction.id), svc.approveCorrection(ctx, correction.id)]);
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

      await expect(svc.approveCorrection(ctx, correction.id)).rejects.toThrow(errors.RecalculationFailedError);

      const stillPending = await svc.getCorrectionDetail(ctx, correction.id);
      expect(stillPending.status).toBe("PENDING");
      expect(stillPending.reviewedByUserId).toBeNull();

      const record = await svc.getAttendanceDay(ctx, employeeGraceId, "2026-03-18");
      expect(record.record.workedMinutes).toBe(480); // the real checkout (09:00-17:00), unaffected by the failed approval
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
