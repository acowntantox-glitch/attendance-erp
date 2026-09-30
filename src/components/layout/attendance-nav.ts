import { can, type Role } from "@/lib/auth/rbac";

/**
 * The Attendance module's navigation, as data. Pure (no React) so the visibility and active-state
 * rules are unit-testable.
 *
 * IMPORTANT: this decides only what to SHOW. Each visibility rule below is exactly the one the
 * sidebar has always used for these pages, and every page and service still enforces its own
 * permission on the server — a hidden link is a convenience, never authorization.
 */
export type AttendanceNavLink = { href: string; label: string };

export type AttendanceNav = {
  /** Operational areas, in display order. */
  items: AttendanceNavLink[];
  /** The configuration pages grouped under the module's "Settings" tab. Empty = no Settings tab. */
  settings: AttendanceNavLink[];
};

/** The module's landing page (self-service check-in / "My Attendance") — available to every role and
 *  the target of the global sidebar's single Attendance entry. */
export const ATTENDANCE_HOME_HREF = "/attendance";

/** Exact match or a true path-prefix match (`/attendance/issues/x` matches `/attendance/issues`, but
 *  `/attendance-old` does not match `/attendance`). */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getAttendanceNav(role: Role): AttendanceNav {
  const items: AttendanceNavLink[] = [];

  // EMPLOYEE already holds attendance.view for its own /attendance page, so that permission alone
  // cannot gate the overview — it is excluded by role explicitly (the page and service enforce it too).
  if (role !== "EMPLOYEE" && can(role, "attendance.view")) {
    items.push({ href: "/attendance/dashboard", label: "Overview" });
  }
  if (can(role, "attendance.report.view")) {
    items.push({ href: "/attendance/calendar", label: "Calendar" });
  }
  if (can(role, "attendance.report.view") || can(role, "attendance.correction.approve")) {
    items.push({ href: "/attendance/issues", label: "Issues & Corrections" });
  }
  if (can(role, "attendance.report.view")) {
    items.push({ href: "/attendance/reports", label: "Reports" });
  }

  const settings: AttendanceNavLink[] = [];
  if (can(role, "attendance.period.lock") || can(role, "attendance.period.unlock")) {
    settings.push({ href: "/attendance/periods", label: "Attendance Periods" });
  }
  if (can(role, "attendance.policy.view")) {
    settings.push({ href: "/attendance/policy", label: "Attendance Policy" });
  }

  return { items, settings };
}

export type AttendanceModuleTab = AttendanceNavLink & { active: boolean };

export type AttendanceModuleNav = {
  /** The horizontal bar: Overview, Calendar, Issues & Corrections, Reports, Settings — only those the
   *  role may open. Empty for a role with no management pages (nothing is rendered then). */
  tabs: AttendanceModuleTab[];
  /** The second row, present only while a Settings page is open and there is a real choice to make
   *  (at least two pages): Attendance Periods | Attendance Policy. */
  secondary: AttendanceModuleTab[] | null;
};

/**
 * What the module's horizontal navigation shows for `role` on `pathname`.
 *
 * - "Settings" is a module-level tab that links to the first Settings page the role can open
 *   (`/attendance/periods` for HR_ADMIN and above, `/attendance/policy` for HR_MANAGER) — there is no
 *   separate Settings page; existing URLs are unchanged.
 * - Active state is exact/prefix-per-route, so at most one primary tab is ever active. `/attendance`
 *   itself (My Attendance) activates none.
 */
export function getAttendanceModuleNav(role: Role, pathname: string): AttendanceModuleNav {
  const { items, settings } = getAttendanceNav(role);

  const tabs: AttendanceModuleTab[] = items.map((link) => ({ ...link, active: isActivePath(pathname, link.href) }));
  const settingsActive = settings.some((link) => isActivePath(pathname, link.href));
  if (settings.length > 0) {
    tabs.push({ href: settings[0]!.href, label: "Settings", active: settingsActive });
  }

  const secondary =
    settingsActive && settings.length >= 2 ? settings.map((link) => ({ ...link, active: isActivePath(pathname, link.href) })) : null;

  return { tabs, secondary };
}
