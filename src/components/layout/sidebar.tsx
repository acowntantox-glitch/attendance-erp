"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { can, type Permission, type Role } from "@/lib/auth/rbac";
import { ATTENDANCE_HOME_HREF, getAttendanceNav, isActivePath, resolveGroupOpen, type AttendanceNavLink } from "./attendance-nav";

/**
 * `permission: null` means always visible (Dashboard). Everything else is gated so a role
 * without the underlying page's required permission never sees a link that crashes when
 * clicked — e.g. a plain EMPLOYEE has no `employee.view`/`location.view`/`department.view`, so
 * "Employees"/"Organization" would otherwise throw AuthorizationError the moment the page tried
 * to list data. (Found via live testing with the seeded EMPLOYEE-role account.)
 *
 * The `group: "attendance"` entry is not a plain link: it renders the Attendance module group
 * (see `AttendanceNavGroup`) at this position.
 */
const NAV_ITEMS: { href: string; label: string; permission: Permission | null; group?: "attendance" }[] = [
  { href: "/dashboard", label: "Dashboard", permission: null },
  { href: "/organization", label: "Organization", permission: "location.view" },
  { href: "/employees", label: "Employees", permission: "employee.view" },
  // Gated on workforce_dashboard.view since that's what every screen under /workforce currently
  // requires (dashboard, schedules, shifts). Revisit once a later batch adds screens an EMPLOYEE
  // can reach via workforce_calendar.view alone (e.g. their own calendar) without the dashboard permission.
  { href: "/workforce", label: "Workforce", permission: "workforce_dashboard.view" },
  { href: ATTENDANCE_HOME_HREF, label: "Attendance", permission: null, group: "attendance" },
  { href: "/devices", label: "Devices", permission: null },
  { href: "/reports", label: "Reports", permission: "report.read" },
  { href: "/settings", label: "Settings", permission: null },
];

const ROW = "block rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900";
const ACTIVE = "bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")}
    >
      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
    </svg>
  );
}

/** Open state for one group: automatic from the URL, with a manual toggle scoped to the current page
 *  (see `resolveGroupOpen`). */
function useGroupOpen(auto: boolean, pathname: string) {
  const [manual, setManual] = useState<{ path: string; open: boolean } | null>(null);
  const open = resolveGroupOpen(auto, manual, pathname);
  return { open, toggle: () => setManual({ path: pathname, open: !open }) };
}

function SubLink({ link, pathname }: { link: AttendanceNavLink; pathname: string }) {
  return (
    <Link
      href={link.href}
      aria-current={pathname === link.href ? "page" : undefined}
      className={cn(ROW, FOCUS, isActivePath(pathname, link.href) && ACTIVE)}
    >
      {link.label}
    </Link>
  );
}

/**
 * The Attendance module as one expandable group. The label is still a link to `/attendance` (the
 * self-service "My Attendance" page every role uses); a separate chevron button expands/collapses the
 * management pages. A role with no management pages (e.g. EMPLOYEE) gets just the link.
 */
function AttendanceNavGroup({ role, pathname }: { role: Role; pathname: string }) {
  const { items, settings } = getAttendanceNav(role);
  const inModule = isActivePath(pathname, ATTENDANCE_HOME_HREF);
  const inSettings = settings.some((link) => isActivePath(pathname, link.href));

  const moduleGroup = useGroupOpen(inModule, pathname);
  const settingsGroup = useGroupOpen(inSettings, pathname);

  const hasChildren = items.length > 0 || settings.length > 0;

  return (
    <div>
      <div className="flex items-center gap-0.5">
        <Link
          href={ATTENDANCE_HOME_HREF}
          aria-current={pathname === ATTENDANCE_HOME_HREF ? "page" : undefined}
          className={cn(ROW, FOCUS, "flex-1", inModule && ACTIVE)}
        >
          Attendance
        </Link>
        {hasChildren && (
          <button
            type="button"
            aria-label="Attendance menu"
            aria-expanded={moduleGroup.open}
            aria-controls="attendance-nav-menu"
            onClick={moduleGroup.toggle}
            className={cn("rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900", FOCUS, inModule && "text-blue-700")}
          >
            <Chevron open={moduleGroup.open} />
          </button>
        )}
      </div>

      {hasChildren && (
        <ul id="attendance-nav-menu" hidden={!moduleGroup.open} className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
          {items.map((link) => (
            <li key={link.href}>
              <SubLink link={link} pathname={pathname} />
            </li>
          ))}
          {settings.length > 0 && (
            <li>
              <button
                type="button"
                aria-expanded={settingsGroup.open}
                aria-controls="attendance-settings-menu"
                onClick={settingsGroup.toggle}
                className={cn(ROW, FOCUS, "flex w-full items-center justify-between text-left", inSettings && "text-blue-700")}
              >
                <span>Settings</span>
                <Chevron open={settingsGroup.open} />
              </button>
              <ul id="attendance-settings-menu" hidden={!settingsGroup.open} className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
                {settings.map((link) => (
                  <li key={link.href}>
                    <SubLink link={link} pathname={pathname} />
                  </li>
                ))}
              </ul>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function Sidebar({ role }: { role: Role }) {
  const activePath = usePathname();
  const visibleItems = NAV_ITEMS.filter((item) => item.permission === null || can(role, item.permission));

  return (
    <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col">
      <div className="flex h-14 items-center border-b border-slate-200 px-5">
        <span className="text-sm font-semibold tracking-tight text-slate-900">Attendance ERP</span>
      </div>
      <nav aria-label="Main navigation" className="flex-1 space-y-0.5 p-3">
        {visibleItems.map((item) => {
          if (item.group === "attendance") {
            return <AttendanceNavGroup key={item.href} role={role} pathname={activePath} />;
          }
          const isActive = isActivePath(activePath, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={activePath === item.href ? "page" : undefined}
              className={cn(ROW, FOCUS, isActive && ACTIVE)}
            >
              {item.label}
            </Link>
          );
        })}
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
