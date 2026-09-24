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
  "attendance.check_in",
  "attendance.check_out",
  "attendance.view",
  "attendance.correction.request",
  "attendance.correction.approve",
  "attendance.correction.reject",
  "attendance.recalculate",
  "attendance.period.lock",
  "attendance.period.unlock",
  "attendance.report.view",
  "schedule.view",
  "schedule.create",
  "schedule.update",
  "schedule.archive",
  "shift.view",
  "shift.create",
  "shift.update",
  "shift.archive",
  "employee_schedule.view",
  "employee_schedule.create",
  "employee_schedule.update",
  "weekly_off.view",
  "weekly_off.create",
  "weekly_off.update",
  "holiday.view",
  "holiday.create",
  "holiday.update",
  "holiday.archive",
  "workforce_calendar.view",
  "workforce_dashboard.view",
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

// Schedules/shifts are admin-defined templates, so they follow the same "full for HR_ADMIN, no
// archive for HR_MANAGER, view-only for MANAGER, no grant for EMPLOYEE" shape as org-structure
// entities above. Holidays are the deliberate exception (see WORKFORCE_HOLIDAY_* below) — they're
// calendar information every employee needs, not management config.
const WORKFORCE_TEMPLATE_FULL: Permission[] = [
  "schedule.view",
  "schedule.create",
  "schedule.update",
  "schedule.archive",
  "shift.view",
  "shift.create",
  "shift.update",
  "shift.archive",
];
const WORKFORCE_TEMPLATE_MANAGE_NO_ARCHIVE: Permission[] = [
  "schedule.view",
  "schedule.create",
  "schedule.update",
  "shift.view",
  "shift.create",
  "shift.update",
];
const WORKFORCE_TEMPLATE_VIEW_ONLY: Permission[] = ["schedule.view", "shift.view"];

// employee_schedule.* / weekly_off.* are never granted to EMPLOYEE — an employee sees their own
// via the service-layer self-view bypass (ctx.employeeId === employeeId), the same pattern
// domains/employee/service.ts already uses for self-viewing one's own employee record.
const WORKFORCE_ASSIGNMENT_FULL: Permission[] = [
  "employee_schedule.view",
  "employee_schedule.create",
  "employee_schedule.update",
  "weekly_off.view",
  "weekly_off.create",
  "weekly_off.update",
];
const WORKFORCE_ASSIGNMENT_VIEW_ONLY: Permission[] = ["employee_schedule.view", "weekly_off.view"];

const WORKFORCE_HOLIDAY_FULL: Permission[] = ["holiday.view", "holiday.create", "holiday.update", "holiday.archive"];
const WORKFORCE_HOLIDAY_MANAGE_NO_ARCHIVE: Permission[] = ["holiday.view", "holiday.create", "holiday.update"];

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
    // "Full attendance permissions except anything explicitly restricted to company-level
    // administration" — period unlock is reserved for COMPANY_ADMIN/SUPER_ADMIN (see §16 of the
    // Batch 1 spec), everything else attendance-related is granted.
    "attendance.check_in",
    "attendance.check_out",
    "attendance.view",
    "attendance.correction.request",
    "attendance.correction.approve",
    "attendance.correction.reject",
    "attendance.recalculate",
    "attendance.period.lock",
    "attendance.report.view",
    ...WORKFORCE_TEMPLATE_FULL,
    ...WORKFORCE_ASSIGNMENT_FULL,
    ...WORKFORCE_HOLIDAY_FULL,
    "workforce_calendar.view",
    "workforce_dashboard.view",
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
    "attendance.check_in",
    "attendance.check_out",
    "attendance.view",
    "attendance.correction.request",
    "attendance.correction.approve",
    "attendance.correction.reject",
    "attendance.recalculate",
    "attendance.report.view",
    ...WORKFORCE_TEMPLATE_MANAGE_NO_ARCHIVE,
    ...WORKFORCE_ASSIGNMENT_FULL,
    ...WORKFORCE_HOLIDAY_MANAGE_NO_ARCHIVE,
    "workforce_calendar.view",
    "workforce_dashboard.view",
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
    // No correction approve/reject, no direct modification, no overtime approval — a line manager
    // can only view and request corrections, per the Batch 1 RBAC spec.
    "attendance.view",
    "attendance.correction.request",
    ...WORKFORCE_TEMPLATE_VIEW_ONLY,
    ...WORKFORCE_ASSIGNMENT_VIEW_ONLY,
    "holiday.view",
    "workforce_calendar.view",
    "workforce_dashboard.view",
    "report.read",
  ],
  // organization.read is the exception, not a gap: it's what the dashboard layout uses to show
  // *your own* company's name/timezone in the header — not sensitive, and every authenticated
  // user needs it just to use the app at all. (Found via live testing: without this, an
  // EMPLOYEE-role login threw AuthorizationError on every page, since DashboardLayout calls
  // getMyCompany() unconditionally — a pre-existing gap from Phase 1, not introduced here.)
  // Self-view of one's own *employee* record is handled entirely by the service-layer bypass
  // (see domains/employee/service.ts), not by a permission grant, per the Phase 2 self-service
  // requirement — hence no employee.* grant here. The same bypass pattern covers an employee's
  // own schedule assignment and weekly-off override (see domains/workforce/service.ts) — no
  // employee_schedule.*/weekly_off.* grant here either.
  // holiday.view IS granted directly (not via a bypass): holidays are company-wide calendar
  // information every employee needs, unlike schedule/shift templates which are management
  // config. workforce_calendar.view is also granted, but the service layer forces
  // employeeId = ctx.employeeId for this role so an EMPLOYEE can only ever see their own day.
  EMPLOYEE: [
    "organization.read",
    "attendance.check_in",
    "attendance.check_out",
    "attendance.view",
    "attendance.correction.request",
    "holiday.view",
    "workforce_calendar.view",
  ],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
