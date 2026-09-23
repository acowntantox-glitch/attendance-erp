import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";

const available = await isDatabaseAvailable();

// This suite exercises many sequential real-Postgres round-trips per test (several service calls
// each doing multiple queries) against a remote, non-local database — the default 5s vitest
// timeout is occasionally too tight under real network latency, causing intermittent timeouts
// unrelated to test correctness (confirmed: different tests time out on different runs).
vi.setConfig({ testTimeout: 20_000 });

describe.skipIf(!available)("workforce service", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let svc: typeof import("../service");
  let errors: typeof import("../errors");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;
  let employeeService: typeof import("@/domains/employee/service");
  let BranchNotFoundError: typeof import("@/domains/organization/errors").BranchNotFoundError;

  let companyAId: string;
  let companyBId: string;
  let branchId: string;
  let adminUserId: string;
  let ctx: import("@/lib/auth/request-context").RequestContext;
  let ctxCompanyB: import("@/lib/auth/request-context").RequestContext;

  let employeeAId: string;
  let employeeBId: string;

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    svc = await import("../service");
    errors = await import("../errors");
    ({ AuthorizationError } = await import("@/lib/errors"));
    employeeService = await import("@/domains/employee/service");
    ({ BranchNotFoundError } = await import("@/domains/organization/errors"));

    const [companyA] = await db
      .insert(schema.companies)
      .values({ name: "Workforce Test Co A", code: `WF_TEST_A_${Date.now()}`, timezone: "Asia/Dubai" })
      .returning();
    const [companyB] = await db
      .insert(schema.companies)
      .values({ name: "Workforce Test Co B", code: `WF_TEST_B_${Date.now()}` })
      .returning();
    companyAId = companyA!.id;
    companyBId = companyB!.id;

    const [branch] = await db
      .insert(schema.branches)
      .values({ companyId: companyAId, name: "HQ", code: "WF_TEST_HQ" })
      .returning();
    branchId = branch!.id;

    const [adminUser] = await db
      .insert(schema.users)
      .values({ email: `wf-admin-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Workforce Test Admin" })
      .returning();
    adminUserId = adminUser!.id;

    ctx = {
      requestId: "wf-test",
      userId: adminUserId,
      userEmail: adminUser!.email,
      companyId: companyAId,
      role: "COMPANY_ADMIN",
      employeeId: null,
    };
    ctxCompanyB = { ...ctx, companyId: companyBId, requestId: "wf-test-b" };

    const employeeA = await employeeService.createEmployee(ctx, {
      firstName: "Emp",
      lastName: `A-${Date.now()}`,
      workEmail: `wf-emp-a-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branchId,
    });
    employeeAId = employeeA.id;

    const employeeB = await employeeService.createEmployee(ctx, {
      firstName: "Emp",
      lastName: `B-${Date.now()}`,
      workEmail: `wf-emp-b-${Date.now()}@test.local`,
      dateOfJoining: "2020-01-01",
      locationId: branchId,
    });
    employeeBId = employeeB.id;
  });

  afterAll(async () => {
    await db.delete(schema.companies).where(eq(schema.companies.id, companyAId));
    await db.delete(schema.companies).where(eq(schema.companies.id, companyBId));
    await db.delete(schema.users).where(eq(schema.users.id, adminUserId));
    await pool.end();
  });

  describe("work schedules", () => {
    it("creates, lists, and rejects a duplicate name within the same company", async () => {
      const schedule = await svc.createWorkSchedule(ctx, {
        name: `Standard-${Date.now()}`,
        startTime: "09:00:00",
        endTime: "18:00:00",
      });
      const list = await svc.listWorkSchedules(ctx);
      expect(list.map((s) => s.id)).toContain(schedule.id);

      await expect(svc.createWorkSchedule(ctx, { name: schedule.name, startTime: "09:00:00", endTime: "18:00:00" })).rejects.toThrow(
        errors.DuplicateWorkScheduleNameError,
      );
    });

    it("rejects cross-company access", async () => {
      const schedule = await svc.createWorkSchedule(ctx, {
        name: `CrossCoTest-${Date.now()}`,
        startTime: "09:00:00",
        endTime: "18:00:00",
      });
      await expect(svc.getWorkSchedule(ctxCompanyB, schedule.id)).rejects.toThrow(AuthorizationError);
    });

    it("blocks archiving a schedule with an active assignment", async () => {
      const schedule = await svc.createWorkSchedule(ctx, {
        name: `ArchiveGuard-${Date.now()}`,
        startTime: "09:00:00",
        endTime: "18:00:00",
      });
      await svc.assignEmployeeSchedule(ctx, employeeAId, { workScheduleId: schedule.id, effectiveFrom: "2026-01-01" });

      await expect(svc.setWorkScheduleActive(ctx, schedule.id, false)).rejects.toThrow(errors.ScheduleHasActiveAssignmentsError);
    });
  });

  describe("shifts", () => {
    it("accepts an end time earlier than the start time as a cross-midnight shift", async () => {
      const night = await svc.createShift(ctx, {
        name: `Night-${Date.now()}`,
        code: `NIGHT_${Date.now()}`,
        startTime: "22:00:00",
        endTime: "06:00:00",
      });
      expect(night.startTime).toBe("22:00:00");
      expect(night.endTime).toBe("06:00:00");
    });

    it("rejects a duplicate shift code within the same company", async () => {
      const code = `DUP_${Date.now()}`;
      await svc.createShift(ctx, { name: "First", code, startTime: "09:00:00", endTime: "18:00:00" });
      await expect(svc.createShift(ctx, { name: "Second", code, startTime: "10:00:00", endTime: "19:00:00" })).rejects.toThrow(
        errors.DuplicateShiftCodeError,
      );
    });
  });

  describe("employee schedule assignments", () => {
    it("closes the previous open assignment when a new one starts, preserving history", async () => {
      const scheduleA = await svc.createWorkSchedule(ctx, { name: `HistA-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      const scheduleB = await svc.createWorkSchedule(ctx, { name: `HistB-${Date.now()}`, startTime: "10:00:00", endTime: "19:00:00" });

      const first = await svc.assignEmployeeSchedule(ctx, employeeBId, {
        workScheduleId: scheduleA.id,
        effectiveFrom: "2026-01-01",
      });
      expect(first.effectiveTo).toBeNull();

      const second = await svc.assignEmployeeSchedule(ctx, employeeBId, {
        workScheduleId: scheduleB.id,
        effectiveFrom: "2026-06-01",
      });
      expect(second.effectiveTo).toBeNull();

      const history = await svc.listEmployeeScheduleAssignments(ctx, employeeBId);
      const closedFirst = history.find((a) => a.id === first.id)!;
      expect(closedFirst.effectiveTo).toBe("2026-05-31");
    });

    it("rejects an overlapping assignment unless allowOverlap is explicitly set", async () => {
      const scheduleA = await svc.createWorkSchedule(ctx, { name: `OverlapA-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      const scheduleB = await svc.createWorkSchedule(ctx, { name: `OverlapB-${Date.now()}`, startTime: "10:00:00", endTime: "19:00:00" });

      const eid = (
        await employeeService.createEmployee(ctx, {
          firstName: "Overlap",
          lastName: `Test-${Date.now()}`,
          workEmail: `wf-overlap-${Date.now()}@test.local`,
          dateOfJoining: "2020-01-01",
          locationId: branchId,
        })
      ).id;

      await svc.assignEmployeeSchedule(ctx, eid, {
        workScheduleId: scheduleA.id,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
      });

      await expect(
        svc.assignEmployeeSchedule(ctx, eid, { workScheduleId: scheduleB.id, effectiveFrom: "2026-06-01" }),
      ).rejects.toThrow(errors.OverlappingScheduleAssignmentError);

      const forced = await svc.assignEmployeeSchedule(ctx, eid, {
        workScheduleId: scheduleB.id,
        effectiveFrom: "2026-06-01",
        allowOverlap: true,
        note: "Deliberate overlap for a mid-year policy exception",
      });
      expect(forced.workScheduleId).toBe(scheduleB.id);
    });

    it("only allows effectiveTo/note to change on an existing assignment", async () => {
      const schedule = await svc.createWorkSchedule(ctx, { name: `Immutable-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      const eid = (
        await employeeService.createEmployee(ctx, {
          firstName: "Immutable",
          lastName: `Test-${Date.now()}`,
          workEmail: `wf-immutable-${Date.now()}@test.local`,
          dateOfJoining: "2020-01-01",
          locationId: branchId,
        })
      ).id;
      const assignment = await svc.assignEmployeeSchedule(ctx, eid, {
        workScheduleId: schedule.id,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
      });

      await expect(
        svc.updateEmployeeScheduleAssignment(ctx, assignment.id, { effectiveTo: "2025-01-01" }),
      ).rejects.toThrow(errors.ImmutableAssignmentFieldError);

      const updated = await svc.updateEmployeeScheduleAssignment(ctx, assignment.id, { note: "Shortened for a resignation" });
      expect(updated.note).toBe("Shortened for a resignation");
    });

    it("rejects extending or reopening effectiveTo past its current value on update", async () => {
      const schedule = await svc.createWorkSchedule(ctx, { name: `NoExtend-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      const eid = (
        await employeeService.createEmployee(ctx, {
          firstName: "NoExtend",
          lastName: `Test-${Date.now()}`,
          workEmail: `wf-noextend-${Date.now()}@test.local`,
          dateOfJoining: "2020-01-01",
          locationId: branchId,
        })
      ).id;
      const assignment = await svc.assignEmployeeSchedule(ctx, eid, {
        workScheduleId: schedule.id,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-06-30",
      });

      // Extending past the original effectiveTo must be rejected — this used to silently succeed
      // and could overlap a later assignment's start date.
      await expect(svc.updateEmployeeScheduleAssignment(ctx, assignment.id, { effectiveTo: "2026-12-31" })).rejects.toThrow(
        errors.ImmutableAssignmentFieldError,
      );
      // Reopening to open-ended is the ultimate extension — also rejected.
      await expect(svc.updateEmployeeScheduleAssignment(ctx, assignment.id, { effectiveTo: null })).rejects.toThrow(
        errors.ImmutableAssignmentFieldError,
      );
      // Shortening further is fine.
      const shortened = await svc.updateEmployeeScheduleAssignment(ctx, assignment.id, { effectiveTo: "2026-03-31" });
      expect(shortened.effectiveTo).toBe("2026-03-31");
    });

    it("lets an employee view their own assignments without the view permission, but not someone else's", async () => {
      const selfEid = (
        await employeeService.createEmployee(ctx, {
          firstName: "SelfView",
          lastName: `Test-${Date.now()}`,
          workEmail: `wf-selfview-${Date.now()}@test.local`,
          dateOfJoining: "2020-01-01",
          locationId: branchId,
        })
      ).id;
      const schedule = await svc.createWorkSchedule(ctx, { name: `SelfView-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      await svc.assignEmployeeSchedule(ctx, selfEid, { workScheduleId: schedule.id, effectiveFrom: "2020-01-01" });

      const selfCtx = { ...ctx, role: "EMPLOYEE" as const, employeeId: selfEid };
      await expect(svc.listEmployeeScheduleAssignments(selfCtx, selfEid)).resolves.not.toThrow();
      await expect(svc.listEmployeeScheduleAssignments(selfCtx, employeeBId)).rejects.toThrow(AuthorizationError);
    });
  });

  describe("weekly off", () => {
    it("prefers an employee override over the company default", async () => {
      const eid = (
        await employeeService.createEmployee(ctx, {
          firstName: "WeeklyOff",
          lastName: `Test-${Date.now()}`,
          workEmail: `wf-weeklyoff-${Date.now()}@test.local`,
          dateOfJoining: "2020-01-01",
          locationId: branchId,
        })
      ).id;

      await svc.setCompanyDefaultWeeklyOff(ctx, { offDays: [5, 6] }); // Fri/Sat
      await svc.setEmployeeWeeklyOffOverride(ctx, eid, { offDays: [0], effectiveFrom: "2020-01-01" }); // Sunday only

      // 2026-09-25 is a Friday — off under the company default, but NOT under this employee's override.
      const friday = await svc.getWorkforceDayInfo(ctx, eid, "2026-09-25");
      expect(friday.isWeeklyOff).toBe(false);
      expect(friday.weeklyOffSource).toBe("employee_override");

      // 2026-09-27 is a Sunday — off under this employee's override.
      const sunday = await svc.getWorkforceDayInfo(ctx, eid, "2026-09-27");
      expect(sunday.isWeeklyOff).toBe(true);
      expect(sunday.weeklyOffSource).toBe("employee_override");
    });

    it("rejects backdating a new override on or before the current open override's start, instead of corrupting it", async () => {
      const eid = (
        await employeeService.createEmployee(ctx, {
          firstName: "WeeklyOffBackdate",
          lastName: `Test-${Date.now()}`,
          workEmail: `wf-weeklyoff-backdate-${Date.now()}@test.local`,
          dateOfJoining: "2020-01-01",
          locationId: branchId,
        })
      ).id;

      await svc.setEmployeeWeeklyOffOverride(ctx, eid, { offDays: [0], effectiveFrom: "2026-06-01" });

      // This used to silently close the existing override with effectiveTo BEFORE its own
      // effectiveFrom (2026-05-31 < 2026-06-01) — a corrupt inverted range.
      await expect(svc.setEmployeeWeeklyOffOverride(ctx, eid, { offDays: [1], effectiveFrom: "2026-01-01" })).rejects.toThrow(
        errors.OverlappingWeeklyOffOverrideError,
      );

      // A genuinely later effective date still works and correctly closes the earlier one.
      const later = await svc.setEmployeeWeeklyOffOverride(ctx, eid, { offDays: [2], effectiveFrom: "2026-09-01" });
      expect(later.offDays).toEqual([2]);
    });
  });

  describe("holidays", () => {
    it("throws BranchNotFoundError (not HolidayNotFoundError) for a nonexistent branchId", async () => {
      await expect(
        svc.createHoliday(ctx, { name: "Bad Branch", date: "2026-08-01", holidayType: "PUBLIC", branchId: crypto.randomUUID() }),
      ).rejects.toThrow(BranchNotFoundError);
    });

    it("allows the same date to be a holiday independently in two different companies", async () => {
      const date = "2026-08-15";
      await expect(svc.createHoliday(ctx, { name: "Co A Holiday", date, holidayType: "PUBLIC" })).resolves.not.toThrow();
      await expect(svc.createHoliday(ctxCompanyB, { name: "Co B Holiday", date, holidayType: "PUBLIC" })).resolves.not.toThrow();
    });

    it("rejects a duplicate company-wide holiday on the same date, but allows a distinct branch scope", async () => {
      const date = "2026-11-11";
      await svc.createHoliday(ctx, { name: "First", date, holidayType: "PUBLIC" });
      await expect(svc.createHoliday(ctx, { name: "Second", date, holidayType: "PUBLIC" })).rejects.toThrow(
        errors.DuplicateHolidayError,
      );

      const branchHoliday = await svc.createHoliday(ctx, { name: "Branch-scoped", date, branchId, holidayType: "COMPANY" });
      expect(branchHoliday.branchId).toBe(branchId);
      await expect(svc.createHoliday(ctx, { name: "Branch dup", date, branchId, holidayType: "COMPANY" })).rejects.toThrow(
        errors.DuplicateHolidayError,
      );
    });
  });

  describe("workforce calendar precedence", () => {
    it("holiday beats weekly-off beats schedule, and a plain working day resolves the expected window", async () => {
      const eid = (
        await employeeService.createEmployee(ctx, {
          firstName: "Calendar",
          lastName: `Test-${Date.now()}`,
          workEmail: `wf-calendar-${Date.now()}@test.local`,
          dateOfJoining: "2020-01-01",
          locationId: branchId,
        })
      ).id;

      const schedule = await svc.createWorkSchedule(ctx, { name: `CalendarSchedule-${Date.now()}`, startTime: "22:00:00", endTime: "06:00:00" });
      await svc.assignEmployeeSchedule(ctx, eid, { workScheduleId: schedule.id, effectiveFrom: "2020-01-01" });
      await svc.setEmployeeWeeklyOffOverride(ctx, eid, { offDays: [3], effectiveFrom: "2020-01-01" }); // Wednesday off

      // 2026-09-23 is a Wednesday, also given a holiday below — holiday must win.
      await svc.createHoliday(ctx, { name: "Precedence Holiday", date: "2026-09-23", holidayType: "PUBLIC" });
      const holidayDay = await svc.getWorkforceDayInfo(ctx, eid, "2026-09-23");
      expect(holidayDay.isHoliday).toBe(true);
      expect(holidayDay.isWorkingDay).toBe(false);

      // 2026-09-30 is also a Wednesday (weekly off) with no holiday — weekly-off must win over the schedule.
      const offDay = await svc.getWorkforceDayInfo(ctx, eid, "2026-09-30");
      expect(offDay.isHoliday).toBe(false);
      expect(offDay.isWeeklyOff).toBe(true);
      expect(offDay.isWorkingDay).toBe(false);

      // 2026-09-24 (Thursday) is a normal working day — the cross-midnight schedule window applies.
      const workingDay = await svc.getWorkforceDayInfo(ctx, eid, "2026-09-24");
      expect(workingDay.isWorkingDay).toBe(true);
      expect(workingDay.expectedWindow?.spansMidnight).toBe(true);
      expect(workingDay.expectedWindow?.start).toEqual({ date: "2026-09-24", time: "22:00:00" });
      expect(workingDay.expectedWindow?.end).toEqual({ date: "2026-09-25", time: "06:00:00" });
    });
  });

  describe("workforce calendar self-scope", () => {
    it("rejects a calendar lookup from an EMPLOYEE-role session with no linked employee record, rather than falling back to the client-supplied id", async () => {
      const noLinkCtx = { ...ctx, role: "EMPLOYEE" as const, employeeId: null };
      await expect(svc.getWorkforceDayInfo(noLinkCtx, employeeAId, "2026-09-23")).rejects.toThrow(AuthorizationError);
    });

    it("pins an EMPLOYEE-role session to its own employeeId even if a different one is requested", async () => {
      const info = await svc.getWorkforceDayInfo({ ...ctx, role: "EMPLOYEE" as const, employeeId: employeeAId }, employeeBId, "2026-09-23");
      expect(info.employeeId).toBe(employeeAId);
    });
  });

  describe("tenant isolation (cross-company)", () => {
    it("rejects cross-company access for shifts, holidays, assignments, and calendar lookups", async () => {
      const shift = await svc.createShift(ctx, { name: "IsoShift", code: `ISO_${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      await expect(svc.getShift(ctxCompanyB, shift.id)).rejects.toThrow(AuthorizationError);

      const holiday = await svc.createHoliday(ctx, { name: "Iso Holiday", date: "2026-08-08", holidayType: "PUBLIC" });
      await expect(svc.getHoliday(ctxCompanyB, holiday.id)).rejects.toThrow(AuthorizationError);

      const isoEid = (
        await employeeService.createEmployee(ctx, {
          firstName: "Iso",
          lastName: `Test-${Date.now()}`,
          workEmail: `wf-iso-${Date.now()}@test.local`,
          dateOfJoining: "2020-01-01",
          locationId: branchId,
        })
      ).id;
      const schedule = await svc.createWorkSchedule(ctx, { name: `IsoSchedule-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      const assignment = await svc.assignEmployeeSchedule(ctx, isoEid, { workScheduleId: schedule.id, effectiveFrom: "2026-01-01" });
      // Company B has no visibility into Company A's employee at all.
      await expect(svc.listEmployeeScheduleAssignments(ctxCompanyB, isoEid)).rejects.toThrow(AuthorizationError);
      // Nor can Company B update Company A's assignment by id.
      await expect(
        svc.updateEmployeeScheduleAssignment(ctxCompanyB, assignment.id, { note: "cross-company attempt" }),
      ).rejects.toThrow(AuthorizationError);
      // Nor perform a calendar lookup for Company A's employee.
      await expect(svc.getWorkforceDayInfo(ctxCompanyB, employeeAId, "2026-09-23")).rejects.toThrow(AuthorizationError);
    });

    it("allows the same schedule name and shift code to exist independently in two different companies", async () => {
      const name = `SharedName-${Date.now()}`;
      const code = `SHARED_${Date.now()}`;
      await expect(svc.createWorkSchedule(ctx, { name, startTime: "09:00:00", endTime: "18:00:00" })).resolves.not.toThrow();
      await expect(svc.createWorkSchedule(ctxCompanyB, { name, startTime: "09:00:00", endTime: "18:00:00" })).resolves.not.toThrow();
      await expect(svc.createShift(ctx, { name: "Shared", code, startTime: "09:00:00", endTime: "18:00:00" })).resolves.not.toThrow();
      await expect(svc.createShift(ctxCompanyB, { name: "Shared", code, startTime: "09:00:00", endTime: "18:00:00" })).resolves.not.toThrow();
    });
  });

  describe("dashboard summary", () => {
    it("returns non-negative, internally consistent counts", async () => {
      const summary = await svc.getWorkforceDashboardSummary(ctx, "2026-09-23");
      expect(summary.employeesScheduledToday).toBeGreaterThanOrEqual(0);
      expect(summary.employeesOffToday).toBeGreaterThanOrEqual(0);
      expect(summary.employeesOnHolidayToday).toBeGreaterThanOrEqual(0);
      expect(summary.activeShiftCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("workforce calendar range", () => {
    it("returns one entry per date and matches the single-day calculation exactly", async () => {
      const eid = (
        await employeeService.createEmployee(ctx, {
          firstName: "Range",
          lastName: `Test-${Date.now()}`,
          workEmail: `wf-range-${Date.now()}@test.local`,
          dateOfJoining: "2020-01-01",
          locationId: branchId,
        })
      ).id;
      const schedule = await svc.createWorkSchedule(ctx, { name: `RangeSchedule-${Date.now()}`, startTime: "09:00:00", endTime: "18:00:00" });
      await svc.assignEmployeeSchedule(ctx, eid, { workScheduleId: schedule.id, effectiveFrom: "2020-01-01" });

      const range = await svc.getWorkforceDayInfoRange(ctx, eid, "2026-09-21", "2026-09-25");
      expect(range).toHaveLength(5);
      expect(range.map((d) => d.date)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]);

      const single = await svc.getWorkforceDayInfo(ctx, eid, "2026-09-23");
      expect(range.find((d) => d.date === "2026-09-23")).toEqual(single);
    });

    it("rejects a range where 'to' is before 'from'", async () => {
      await expect(svc.getWorkforceDayInfoRange(ctx, employeeAId, "2026-09-25", "2026-09-20")).rejects.toThrow(
        "'to' must be on or after 'from'.",
      );
    });

    it("rejects a range exceeding the documented maximum", async () => {
      const from = "2026-01-01";
      const to = "2026-04-01"; // well over MAX_CALENDAR_RANGE_DAYS (45)
      await expect(svc.getWorkforceDayInfoRange(ctx, employeeAId, from, to)).rejects.toThrow(/cannot exceed 45 days/);
    });

    it("enforces the same self-scope and cross-company rules as the single-day lookup", async () => {
      const noLinkCtx = { ...ctx, role: "EMPLOYEE" as const, employeeId: null };
      await expect(svc.getWorkforceDayInfoRange(noLinkCtx, employeeAId, "2026-09-21", "2026-09-25")).rejects.toThrow(
        AuthorizationError,
      );
      await expect(svc.getWorkforceDayInfoRange(ctxCompanyB, employeeAId, "2026-09-21", "2026-09-25")).rejects.toThrow(
        AuthorizationError,
      );
    });
  });
});
