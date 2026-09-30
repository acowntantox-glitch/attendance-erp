import { can, type Role } from "@/lib/auth/rbac";

/**
 * The Attendance module's navigation, as data. Pure (no React) so the visibility rules are
 * unit-testable.
 *
 * IMPORTANT: this decides only what to SHOW. Each rule below is exactly the one the sidebar used
 * before the regrouping, and every page and service still enforces its own permission on the
 * server — a hidden link is a convenience, never authorization.
 */
export type AttendanceNavLink = { href: string; label: string };

export type AttendanceNav = {
  /** Operational areas, in display order. */
  items: AttendanceNavLink[];
  /** The nested "Settings" section (configuration). Empty means the Settings group is not shown. */
  settings: AttendanceNavLink[];
};

/** The module's own landing page (self-service check-in / "My Attendance") — available to every role. */
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

/**
 * Whether a nav group is open. `auto` is derived from the URL; `manual` is the user's last toggle and
 * applies ONLY to the page it was made on (`manual.path`). Navigating anywhere else therefore returns
 * to the automatic state — so being inside the module always shows it expanded — with no effect that
 * syncs state after render.
 */
export function resolveGroupOpen(auto: boolean, manual: { path: string; open: boolean } | null, pathname: string): boolean {
  return manual !== null && manual.path === pathname ? manual.open : auto;
}
