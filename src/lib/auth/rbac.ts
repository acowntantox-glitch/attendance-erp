import type { roleEnum } from "@/db/schema";

export type Role = (typeof roleEnum.enumValues)[number];

export const ROLES: readonly Role[] = [
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "HR_ADMIN",
  "HR_MANAGER",
  "MANAGER",
  "EMPLOYEE",
] as const;

/**
 * Permission strings follow `<domain>.<action>`. Only the permissions needed to exercise the
 * Phase 1 foundation (organization CRUD) are enumerated; later phases add attendance.*,
 * device.*, report.* etc. without changing this shape.
 */
export const PERMISSIONS = [
  "organization.read",
  "organization.manage",
  "employee.read",
  "employee.create",
  "employee.update",
  "attendance.read",
  "attendance.create",
  "attendance.correct",
  "attendance.approve",
  "schedule.read",
  "schedule.manage",
  "device.read",
  "device.manage",
  "report.read",
  "user.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: [...PERMISSIONS],
  COMPANY_ADMIN: [...PERMISSIONS],
  HR_ADMIN: [
    "organization.read",
    "employee.read",
    "employee.create",
    "employee.update",
    "attendance.read",
    "attendance.correct",
    "attendance.approve",
    "schedule.read",
    "schedule.manage",
    "device.read",
    "device.manage",
    "report.read",
    "user.manage",
  ],
  HR_MANAGER: [
    "organization.read",
    "employee.read",
    "employee.create",
    "employee.update",
    "attendance.read",
    "attendance.correct",
    "attendance.approve",
    "schedule.read",
    "report.read",
  ],
  MANAGER: ["organization.read", "employee.read", "attendance.read", "attendance.approve", "report.read"],
  EMPLOYEE: ["attendance.read", "attendance.create"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
