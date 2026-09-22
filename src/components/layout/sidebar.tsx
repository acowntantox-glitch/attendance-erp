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
  { href: "/workforce", label: "Workforce", permission: null },
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
      </nav>
    </aside>
  );
}
