"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { can, type Permission, type Role } from "@/lib/auth/rbac";
import { ATTENDANCE_HOME_HREF, isActivePath } from "./attendance-nav";

/**
 * `permission: null` means always visible (Dashboard). Everything else is gated so a role
 * without the underlying page's required permission never sees a link that crashes when
 * clicked — e.g. a plain EMPLOYEE has no `employee.view`/`location.view`/`department.view`, so
 * "Employees"/"Organization" would otherwise throw AuthorizationError the moment the page tried
 * to list data. (Found via live testing with the seeded EMPLOYEE-role account.)
 *
 * Attendance is ONE entry here. It links to `/attendance` (the self-service "My Attendance" page
 * every role uses); the module's own areas — Overview, Calendar, Issues & Corrections, Reports and
 * Settings — are reached through the horizontal navigation rendered by `attendance/layout.tsx`, not
 * as sidebar children.
 */
const NAV_ITEMS: { href: string; label: string; permission: Permission | null }[] = [
  { href: "/dashboard", label: "Dashboard", permission: null },
  { href: "/organization", label: "Organization", permission: "location.view" },
  { href: "/employees", label: "Employees", permission: "employee.view" },
  // Gated on workforce_dashboard.view since that's what every screen under /workforce currently
  // requires (dashboard, schedules, shifts). Revisit once a later batch adds screens an EMPLOYEE
  // can reach via workforce_calendar.view alone (e.g. their own calendar) without the dashboard permission.
  { href: "/workforce", label: "Workforce", permission: "workforce_dashboard.view" },
  { href: ATTENDANCE_HOME_HREF, label: "Attendance", permission: null },
  { href: "/devices", label: "Devices", permission: null },
  { href: "/reports", label: "Reports", permission: "report.read" },
  { href: "/settings", label: "Settings", permission: null },
];

const ROW = "block rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900";
const ACTIVE = "bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600";

export function Sidebar({ role }: { role: Role }) {
  const activePath = usePathname();
  const visibleItems = NAV_ITEMS.filter((item) => item.permission === null || can(role, item.permission));

  return (
    <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col">
      <div className="flex h-14 items-center border-b border-slate-200 px-5">
        <span className="text-sm font-semibold tracking-tight text-slate-900">Attendance ERP</span>
      </div>
      <nav aria-label="Main navigation" className="flex-1 space-y-0.5 p-3">
        {visibleItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={activePath === item.href ? "page" : undefined}
            className={cn(ROW, FOCUS, isActivePath(activePath, item.href) && ACTIVE)}
          >
            {item.label}
          </Link>
        ))}
        {!can(role, "employee.view") && (
          <Link
            href="/employees/me"
            aria-current={activePath === "/employees/me" ? "page" : undefined}
            className={cn(ROW, FOCUS, isActivePath(activePath, "/employees/me") && ACTIVE)}
          >
            My Profile
          </Link>
        )}
      </nav>
    </aside>
  );
}
