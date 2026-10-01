import { describe, expect, it } from "vitest";
import { can, canManageUserRole, canReviewAttendanceCorrection, getMinimumAttendanceCorrectionApproverRole, permissionsForRole, ROLES } from "./rbac";

describe("rbac", () => {
  it("grants SUPER_ADMIN and COMPANY_ADMIN every permission", () => {
    for (const permission of permissionsForRole("SUPER_ADMIN")) {
      expect(can("COMPANY_ADMIN", permission)).toBe(true);
    }
  });

  it("does not grant EMPLOYEE organization management", () => {
    expect(can("EMPLOYEE", "organization.manage")).toBe(false);
    expect(can("EMPLOYEE", "attendance.check_in")).toBe(true);
  });

  it("grants every role organization.read — the dashboard layout calls getMyCompany() for every authenticated user regardless of role, to show their own company's name in the header", () => {
    for (const role of ROLES) {
      expect(can(role, "organization.read")).toBe(true);
    }
  });

  it("F-03: employee.view_documents is HR/admin-only - MANAGER and EMPLOYEE do not hold it, even though MANAGER holds employee.view", () => {
    for (const role of ["SUPER_ADMIN", "COMPANY_ADMIN", "HR_ADMIN", "HR_MANAGER"] as const) {
      expect(can(role, "employee.view_documents")).toBe(true);
    }
    expect(can("MANAGER", "employee.view")).toBe(true);
    expect(can("MANAGER", "employee.view_documents")).toBe(false);
    expect(can("EMPLOYEE", "employee.view_documents")).toBe(false);
    // Upload/archive stay on the existing permission.
    expect(can("MANAGER", "employee.manage_documents")).toBe(false);
    expect(can("HR_MANAGER", "employee.manage_documents")).toBe(true);
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

  describe("Batch 12: attendance correction approval hierarchy", () => {
    it("returns the correct minimum approver role per requester role", () => {
      expect(getMinimumAttendanceCorrectionApproverRole("EMPLOYEE")).toBe("HR_MANAGER");
      expect(getMinimumAttendanceCorrectionApproverRole("MANAGER")).toBe("HR_MANAGER");
      expect(getMinimumAttendanceCorrectionApproverRole("HR_MANAGER")).toBe("HR_ADMIN");
      expect(getMinimumAttendanceCorrectionApproverRole("HR_ADMIN")).toBe("COMPANY_ADMIN");
    });

    it("returns null for COMPANY_ADMIN and SUPER_ADMIN requesters — no added minimum beyond the existing approval-permission model", () => {
      expect(getMinimumAttendanceCorrectionApproverRole("COMPANY_ADMIN")).toBeNull();
      expect(getMinimumAttendanceCorrectionApproverRole("SUPER_ADMIN")).toBeNull();
    });

    it("allows an approver whose rank meets or exceeds the requester's minimum", () => {
      expect(canReviewAttendanceCorrection("EMPLOYEE", "HR_MANAGER")).toBe(true);
      expect(canReviewAttendanceCorrection("EMPLOYEE", "HR_ADMIN")).toBe(true);
      expect(canReviewAttendanceCorrection("EMPLOYEE", "COMPANY_ADMIN")).toBe(true);
      expect(canReviewAttendanceCorrection("EMPLOYEE", "SUPER_ADMIN")).toBe(true);
      expect(canReviewAttendanceCorrection("MANAGER", "HR_MANAGER")).toBe(true);
      expect(canReviewAttendanceCorrection("HR_MANAGER", "HR_ADMIN")).toBe(true);
      expect(canReviewAttendanceCorrection("HR_ADMIN", "COMPANY_ADMIN")).toBe(true);
      expect(canReviewAttendanceCorrection("HR_ADMIN", "SUPER_ADMIN")).toBe(true);
    });

    it("rejects an approver whose rank is below the requester's minimum", () => {
      expect(canReviewAttendanceCorrection("HR_ADMIN", "HR_MANAGER")).toBe(false);
      expect(canReviewAttendanceCorrection("HR_MANAGER", "MANAGER")).toBe(false);
      expect(canReviewAttendanceCorrection("EMPLOYEE", "MANAGER")).toBe(false);
    });

    it("imposes no minimum-rank restriction for a COMPANY_ADMIN or SUPER_ADMIN requester — any approve-capable role passes here (self-approval is checked separately by the caller)", () => {
      expect(canReviewAttendanceCorrection("COMPANY_ADMIN", "HR_MANAGER")).toBe(true);
      expect(canReviewAttendanceCorrection("COMPANY_ADMIN", "HR_ADMIN")).toBe(true);
      expect(canReviewAttendanceCorrection("SUPER_ADMIN", "HR_MANAGER")).toBe(true);
      expect(canReviewAttendanceCorrection("SUPER_ADMIN", "HR_ADMIN")).toBe(true);
    });
  });
});

describe("attendance.process.view (Batch 13)", () => {
  it("is held by HR_ADMIN, HR_MANAGER and the company-level admins, and by no other role", () => {
    expect(can("SUPER_ADMIN", "attendance.process.view")).toBe(true);
    expect(can("COMPANY_ADMIN", "attendance.process.view")).toBe(true);
    expect(can("HR_ADMIN", "attendance.process.view")).toBe(true);
    expect(can("HR_MANAGER", "attendance.process.view")).toBe(true);
    expect(can("MANAGER", "attendance.process.view")).toBe(false);
    expect(can("EMPLOYEE", "attendance.process.view")).toBe(false);
  });
});

describe("user management permissions (Batch 15)", () => {
  it("user.manage is held only by HR_ADMIN and the two admin roles", () => {
    for (const role of ["SUPER_ADMIN", "COMPANY_ADMIN", "HR_ADMIN"] as const) expect(can(role, "user.manage")).toBe(true);
    for (const role of ["HR_MANAGER", "MANAGER", "EMPLOYEE"] as const) expect(can(role, "user.manage")).toBe(false);
  });

  it("canManageUserRole: nobody manages a higher rank; HR_ADMIN cannot touch admins or peers", () => {
    expect(canManageUserRole("HR_ADMIN", "COMPANY_ADMIN")).toBe(false);
    expect(canManageUserRole("HR_ADMIN", "SUPER_ADMIN")).toBe(false);
    expect(canManageUserRole("HR_ADMIN", "HR_ADMIN")).toBe(false);
    expect(canManageUserRole("HR_ADMIN", "HR_MANAGER")).toBe(true);
    expect(canManageUserRole("HR_ADMIN", "MANAGER")).toBe(true);
    expect(canManageUserRole("HR_ADMIN", "EMPLOYEE")).toBe(true);
  });

  it("COMPANY_ADMIN manages everyone except SUPER_ADMIN; SUPER_ADMIN manages anyone", () => {
    expect(canManageUserRole("COMPANY_ADMIN", "SUPER_ADMIN")).toBe(false);
    for (const target of ["COMPANY_ADMIN", "HR_ADMIN", "HR_MANAGER", "MANAGER", "EMPLOYEE"] as const) {
      expect(canManageUserRole("COMPANY_ADMIN", target)).toBe(true);
    }
    for (const target of ROLES) expect(canManageUserRole("SUPER_ADMIN", target)).toBe(true);
  });

  it("for every non-admin actor the rule is exactly 'strictly higher rank' (holding user.manage is checked separately)", () => {
    const order = ["EMPLOYEE", "MANAGER", "HR_MANAGER", "HR_ADMIN"] as const;
    for (const actor of order) {
      for (const target of ROLES) {
        const targetRank = order.indexOf(target as (typeof order)[number]);
        const expected = targetRank !== -1 && order.indexOf(actor) > targetRank;
        expect(canManageUserRole(actor, target)).toBe(expected);
      }
    }
  });
});
