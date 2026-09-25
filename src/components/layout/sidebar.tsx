"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { can, type Permission, type Role } from "@/lib/auth/rbac";

/**
 * `permission: null` means always visible (Dashboard). Everything else is gated so a role
 * without the underlying page's required permission never sees a link that crashes when
 * clicked — e.g. a plain EMPLOYEE has no `employee.view`/`location.view`/`department.view`, so
 * "Employees"/"Organization" would otherwise throw AuthorizationError the moment the page tried
 * to list data. (Found via live testing with the seeded EMPLOYEE-role account.)
 */
const NAV_ITEMS: { href: string; label: string; permission: Permission | null }[] = [
  { href: "/dashboard", label: "Dashboard", permission: null },
  { href: "/organization", label: "Organization", permission: "location.view" },
  { href: "/employees", label: "Employees", permission: "employee.view" },
  // Gated on workforce_dashboard.view since that's what every screen under /workforce currently
  // requires (dashboard, schedules, shifts). Revisit once a later batch adds screens an EMPLOYEE
  // can reach via workforce_calendar.view alone (e.g. their own calendar) without the dashboard permission.
  { href: "/workforce", label: "Workforce", permission: "workforce_dashboard.view" },
  { href: "/attendance", label: "Attendance", permission: null },
  { href: "/devices", label: "Devices", permission: null },
  { href: "/reports", label: "Reports", permission: "report.read" },
  { href: "/settings", label: "Settings", permission: null },
];

export function Sidebar({ role }: { role: Role }) {
  const activePath = usePathname();
  const visibleItems = NAV_ITEMS.filter((item) => item.permission === null || can(role, item.permission));

  return (
    <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col">
      <div className="flex h-14 items-center border-b border-slate-200 px-5">
        <span className="text-sm font-semibold tracking-tight text-slate-900">Attendance ERP</span>
      </div>
      <nav className="flex-1 space-y-0.5 p-3">
        {visibleItems.map((item) => {
          const isActive = activePath === item.href || activePath.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "block rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                isActive && "bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700",
              )}
            >
              {item.label}
            </Link>
          );
        })}
        {!can(role, "employee.view") && (
          <Link
            href="/employees/me"
            className={cn(
              "block rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              activePath.startsWith("/employees/me") && "bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700",
            )}
          >
            My Profile
          </Link>
        )}
        {/* EMPLOYEE already holds attendance.view for its own /attendance self-service page, so
            that permission alone can't gate this link the way NAV_ITEMS does above — it's excluded
            by role explicitly instead (the dashboard page and service both enforce this too). */}
        {role !== "EMPLOYEE" && can(role, "attendance.view") && (
          <Link
            href="/attendance/dashboard"
            className={cn(
              "block rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              activePath.startsWith("/attendance/dashboard") && "bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700",
            )}
          >
            Attendance Dashboard
          </Link>
        )}
        {/* Gated on attendance.report.view (Batch 6) — a dedicated permission, not `report.read`
            (which MANAGER also holds) or `attendance.view` (which EMPLOYEE also holds): neither
            existing permission excludes exactly "MANAGER and EMPLOYEE, but not HR", which this
            report requires. See rbac.ts. */}
        {can(role, "attendance.report.view") && (
          <Link
            href="/attendance/reports"
            className={cn(
              "block rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              activePath.startsWith("/attendance/reports") && "bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700",
            )}
          >
            Attendance Reports
          </Link>
        )}
        {/* Batch 7 — same permission as Attendance Reports; no new permission introduced. */}
        {can(role, "attendance.report.view") && (
          <Link
            href="/attendance/calendar"
            className={cn(
              "block rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              activePath.startsWith("/attendance/calendar") && "bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700",
            )}
          >
            Attendance Calendar
          </Link>
        )}
        {/* Batch 10 — view gated on the same attendance.report.view as Reports/Calendar (MANAGER
            excluded exactly as it already is from those); dismiss/undismiss on the page itself
            are separately gated on attendance.exception.manage. */}
        {can(role, "attendance.report.view") && (
          <Link
            href="/attendance/exceptions"
            className={cn(
              "block rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              activePath.startsWith("/attendance/exceptions") && "bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700",
            )}
          >
            Attendance Exceptions
          </Link>
        )}
        {/* Gated on attendance.correction.approve, not attendance.view — MANAGER holds correction
            .request but not .approve (per the Batch 4 RBAC table), so it never sees the HR queue
            link even though it can view attendance; the service layer enforces this independently. */}
        {can(role, "attendance.correction.approve") && (
          <Link
            href="/attendance/corrections"
            className={cn(
              "block rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              activePath.startsWith("/attendance/corrections") && "bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700",
            )}
          >
            Attendance Corrections
          </Link>
        )}
        {/* Batch 8 — visible to whoever holds either half of period management; currently only
            HR_ADMIN (and implicit COMPANY_ADMIN/SUPER_ADMIN) hold either permission. Not tied to
            attendance.report.view since period lock/unlock is a distinct capability from reading
            reports. */}
        {(can(role, "attendance.period.lock") || can(role, "attendance.period.unlock")) && (
          <Link
            href="/attendance/periods"
            className={cn(
              "block rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              activePath.startsWith("/attendance/periods") && "bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700",
            )}
          >
            Attendance Periods
          </Link>
        )}
      </nav>
    </aside>
  );
}
