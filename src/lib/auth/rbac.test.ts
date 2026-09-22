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

  it("does not grant MANAGER user management", () => {
    expect(can("MANAGER", "user.manage")).toBe(false);
  });

  it("defines a non-empty permission set for every role", () => {
    for (const role of ROLES) {
      expect(permissionsForRole(role).length).toBeGreaterThan(0);
    }
  });
});
