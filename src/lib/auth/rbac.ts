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
 * Permission strings follow `<domain>.<action>`. `organization.read`/`.manage` are legacy
 * Phase 1 names still used by `getMyCompany`; department/designation/location/employee use the
 * granular Phase 2 set. `employee.read/.create/.update` (Phase 1 placeholders, never referenced
 * by any route/service) are replaced by the granular `employee.*` set below.
 */
export const PERMISSIONS = [
  "organization.read",
  "organization.manage",
  "department.view",
  "department.create",
  "department.update",
  "department.archive",
  "designation.view",
  "designation.create",
  "designation.update",
  "designation.archive",
  "location.view",
  "location.create",
  "location.update",
  "location.archive",
  "employee.view",
  "employee.create",
  "employee.update",
  "employee.archive",
  "employee.manage_status",
  "employee.manage_documents",
  "employee.view_private",
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

const ORG_STRUCTURE_FULL: Permission[] = [
  "department.view",
  "department.create",
  "department.update",
  "department.archive",
  "designation.view",
  "designation.create",
  "designation.update",
  "designation.archive",
  "location.view",
  "location.create",
  "location.update",
  "location.archive",
];

const ORG_STRUCTURE_VIEW_ONLY: Permission[] = ["department.view", "designation.view", "location.view"];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: [...PERMISSIONS],
  COMPANY_ADMIN: [...PERMISSIONS],
  HR_ADMIN: [
    "organization.read",
    ...ORG_STRUCTURE_FULL,
    "employee.view",
    "employee.create",
    "employee.update",
    "employee.archive",
    "employee.manage_status",
    "employee.manage_documents",
    "employee.view_private",
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
    "department.view",
    "department.create",
    "department.update",
    "designation.view",
    "designation.create",
    "designation.update",
    "location.view",
    "employee.view",
    "employee.create",
    "employee.update",
    "employee.manage_status",
    "employee.manage_documents",
    "employee.view_private",
    "attendance.read",
    "attendance.correct",
    "attendance.approve",
    "schedule.read",
    "report.read",
  ],
  MANAGER: [
    "organization.read",
    ...ORG_STRUCTURE_VIEW_ONLY,
    "employee.view",
    // A line manager can update basic employment info for their team (e.g. department/location)
    // but employment status changes (suspension, termination, ...) are deliberately HR-only —
    // hence employee.update without employee.manage_status.
    "employee.update",
    "attendance.read",
    "attendance.approve",
    "report.read",
  ],
  // organization.read is the exception, not a gap: it's what the dashboard layout uses to show
  // *your own* company's name/timezone in the header — not sensitive, and every authenticated
  // user needs it just to use the app at all. (Found via live testing: without this, an
  // EMPLOYEE-role login threw AuthorizationError on every page, since DashboardLayout calls
  // getMyCompany() unconditionally — a pre-existing gap from Phase 1, not introduced here.)
  // Self-view of one's own *employee* record is handled entirely by the service-layer bypass
  // (see domains/employee/service.ts), not by a permission grant, per the Phase 2 self-service
  // requirement — hence no employee.* grant here.
  EMPLOYEE: ["organization.read", "attendance.read", "attendance.create"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
