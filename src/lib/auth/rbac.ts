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
  "employee.view_documents",
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
  "attendance.exception.manage",
  "attendance.policy.view",
  "attendance.policy.update",
  "attendance.process.view",
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
    // Viewing/downloading employee documents (contracts, IDs, visas) is HR-only: a line manager holds
    // employee.view but NOT this. Self-access is a service-layer bypass, like the rest of the employee data.
    "employee.view_documents",
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
    "attendance.exception.manage",
    "attendance.policy.view",
    "attendance.policy.update",
    "attendance.process.view",
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
    "employee.view_documents",
    "employee.view_private",
    "attendance.check_in",
    "attendance.check_out",
    "attendance.view",
    "attendance.correction.request",
    "attendance.correction.approve",
    "attendance.correction.reject",
    "attendance.recalculate",
    "attendance.report.view",
    "attendance.exception.manage",
    // View-only: changing company-wide calculation rules is an HR_ADMIN-and-above action, the same
    // split as schedules/shifts (no archive) vs. period unlock.
    "attendance.policy.view",
    "attendance.process.view",
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

// ---------------------------------------------------------------------------
// Attendance correction approval hierarchy (Batch 12) — deliberately its own small, named policy,
// not a general-purpose role-seniority ranking: the `ROLES` array's declaration order is not a
// safe stand-in for approval authority anywhere else in this codebase, so this hierarchy is
// encoded explicitly and only covers the roles that ever hold `attendance.correction.approve`/
// `.reject` in the first place (HR_MANAGER, HR_ADMIN, COMPANY_ADMIN, SUPER_ADMIN).
// ---------------------------------------------------------------------------

type AttendanceCorrectionApproverRole = "HR_MANAGER" | "HR_ADMIN" | "COMPANY_ADMIN" | "SUPER_ADMIN";

const ATTENDANCE_CORRECTION_APPROVER_RANK: Record<AttendanceCorrectionApproverRole, number> = {
  HR_MANAGER: 1,
  HR_ADMIN: 2,
  COMPANY_ADMIN: 3,
  SUPER_ADMIN: 4,
};

/**
 * Requester role -> minimum role required to approve/reject their correction. COMPANY_ADMIN and
 * SUPER_ADMIN are intentionally absent: for those two requester roles there is no additional
 * minimum beyond already holding `attendance.correction.approve`/`.reject` (the existing
 * permission model applies as-is) — self-approval prevention is the only extra constraint for
 * them, enforced separately by the caller (a same-user check, not a role check).
 */
const MINIMUM_ATTENDANCE_CORRECTION_APPROVER: Partial<Record<Role, AttendanceCorrectionApproverRole>> = {
  EMPLOYEE: "HR_MANAGER",
  MANAGER: "HR_MANAGER",
  HR_MANAGER: "HR_ADMIN",
  HR_ADMIN: "COMPANY_ADMIN",
};

/** The minimum role required to approve/reject a correction requested by `requesterRole`, or
 *  `null` when this requester role has no added minimum (COMPANY_ADMIN/SUPER_ADMIN — see above). */
export function getMinimumAttendanceCorrectionApproverRole(requesterRole: Role): Role | null {
  return MINIMUM_ATTENDANCE_CORRECTION_APPROVER[requesterRole] ?? null;
}

/**
 * Whether `approverRole` has sufficient hierarchy authority to review (approve or reject) a
 * correction requested by `requesterRole`. This is the hierarchy half of the policy only — it
 * does not check self-approval (a same-user comparison the caller must also apply) and does not
 * check that `approverRole` holds `attendance.correction.approve`/`.reject` at all (the existing
 * `requirePermission` call already guards that before this ever runs).
 */
export function canReviewAttendanceCorrection(requesterRole: Role, approverRole: Role): boolean {
  const minimumRole = getMinimumAttendanceCorrectionApproverRole(requesterRole);
  if (minimumRole === null) return true;
  const approverRank = ATTENDANCE_CORRECTION_APPROVER_RANK[approverRole as AttendanceCorrectionApproverRole];
  if (approverRank === undefined) return false;
  return approverRank >= ATTENDANCE_CORRECTION_APPROVER_RANK[minimumRole as AttendanceCorrectionApproverRole];
}

// ---------------------------------------------------------------------------
// User-management hierarchy (Batch 15). `user.manage` alone must not let an HR_ADMIN reset a
// COMPANY_ADMIN's password (that is account takeover / privilege escalation), so who may manage whom
// is an explicit, named rule — deliberately not derived from the order of the `ROLES` array. Like the
// correction-approval hierarchy above, it only says WHO MAY ACT ON WHOM; holding `user.manage` is
// still checked separately, and acting on oneself is refused separately by the caller.
// ---------------------------------------------------------------------------

const USER_MANAGEMENT_RANK: Record<Role, number> = {
  EMPLOYEE: 0,
  MANAGER: 1,
  HR_MANAGER: 2,
  HR_ADMIN: 3,
  COMPANY_ADMIN: 4,
  SUPER_ADMIN: 5,
};

/**
 * Whether `actorRole` may activate/deactivate or reset the password of a user whose role in the same
 * company is `targetRole`: strictly lower rank, except that COMPANY_ADMIN may also manage another
 * COMPANY_ADMIN and SUPER_ADMIN may manage anyone. Nobody manages a higher rank.
 */
export function canManageUserRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === "SUPER_ADMIN") return true;
  if (actorRole === "COMPANY_ADMIN") return USER_MANAGEMENT_RANK[targetRole] <= USER_MANAGEMENT_RANK.COMPANY_ADMIN;
  return USER_MANAGEMENT_RANK[actorRole] > USER_MANAGEMENT_RANK[targetRole];
}
