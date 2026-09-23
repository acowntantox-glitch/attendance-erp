"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { can, type Permission, type Role } from "@/lib/auth/rbac";

const ITEMS: { href: string; label: string; permission: Permission }[] = [
  { href: "/workforce", label: "Dashboard", permission: "workforce_dashboard.view" },
  { href: "/workforce/schedules", label: "Schedules", permission: "schedule.view" },
  { href: "/workforce/shifts", label: "Shifts", permission: "shift.view" },
  { href: "/workforce/weekly-offs", label: "Weekly Offs", permission: "weekly_off.view" },
  { href: "/workforce/holidays", label: "Holidays", permission: "holiday.view" },
  { href: "/workforce/calendar", label: "Calendar", permission: "workforce_calendar.view" },
];

/**
 * Permission-aware since EMPLOYEE now has `workforce_calendar.view` (Calendar) without the other
 * four `/workforce/*` permissions — an unfiltered nav would show links that 404-equivalent
 * ("you don't have permission") for that role, same rationale as the main Sidebar's own gating.
 */
export function WorkforceSubNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const visibleItems = ITEMS.filter((item) => can(role, item.permission));

  return (
    <nav className="flex gap-1 border-b border-slate-200" aria-label="Workforce sections">
      {visibleItems.map((item) => {
        const isActive = item.href === "/workforce" ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
              isActive ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
