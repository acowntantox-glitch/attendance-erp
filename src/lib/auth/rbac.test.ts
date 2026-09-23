import { describe, expect, it } from "vitest";
import { can, permissionsForRole, ROLES } from "./rbac";

describe("rbac", () => {
  it("grants SUPER_ADMIN and COMPANY_ADMIN every permission", () => {
    for (const permission of permissionsForRole("SUPER_ADMIN")) {
      expect(can("COMPANY_ADMIN", permission)).toBe(true);
    }
  });

  it("does not grant EMPLOYEE organization management", () => {
    expect(can("EMPLOYEE", "organization.manage")).toBe(false);
    expect(can("EMPLOYEE", "attendance.create")).toBe(true);
  });

  it("grants every role organization.read — the dashboard layout calls getMyCompany() for every authenticated user regardless of role, to show their own company's name in the header", () => {
    for (const role of ROLES) {
      expect(can(role, "organization.read")).toBe(true);
    }
  });

  it("does not grant MANAGER user management", () => {
    expect(can("MANAGER", "user.manage")).toBe(false);
  });

  it("defines a non-empty permission set for every role", () => {
    for (const role of ROLES) {
      expect(permissionsForRole(role).length).toBeGreaterThan(0);
    }
  });

  it("gives HR_MANAGER schedule/shift manage but not archive, mirroring the department/designation gap", () => {
    expect(can("HR_MANAGER", "schedule.create")).toBe(true);
    expect(can("HR_MANAGER", "schedule.archive")).toBe(false);
    expect(can("HR_MANAGER", "shift.update")).toBe(true);
    expect(can("HR_MANAGER", "shift.archive")).toBe(false);
  });

  it("gives MANAGER view-only on schedules/shifts/assignments/weekly-off", () => {
    for (const permission of [
      "schedule.create",
      "shift.create",
      "employee_schedule.create",
      "weekly_off.create",
    ] as const) {
      expect(can("MANAGER", permission)).toBe(false);
    }
    expect(can("MANAGER", "schedule.view")).toBe(true);
    expect(can("MANAGER", "employee_schedule.view")).toBe(true);
  });

  it("grants EMPLOYEE holiday.view and workforce_calendar.view, but no schedule/shift/assignment management", () => {
    expect(can("EMPLOYEE", "holiday.view")).toBe(true);
    expect(can("EMPLOYEE", "workforce_calendar.view")).toBe(true);
    expect(can("EMPLOYEE", "workforce_dashboard.view")).toBe(false);
    expect(can("EMPLOYEE", "schedule.view")).toBe(false);
    expect(can("EMPLOYEE", "employee_schedule.view")).toBe(false);
    expect(can("EMPLOYEE", "weekly_off.view")).toBe(false);
  });

  it("grants workforce_dashboard.view to every management role but not EMPLOYEE", () => {
    for (const role of ["SUPER_ADMIN", "COMPANY_ADMIN", "HR_ADMIN", "HR_MANAGER", "MANAGER"] as const) {
      expect(can(role, "workforce_dashboard.view")).toBe(true);
    }
    expect(can("EMPLOYEE", "workforce_dashboard.view")).toBe(false);
  });
});
