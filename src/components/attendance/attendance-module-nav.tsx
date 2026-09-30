"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/auth/rbac";
import { getAttendanceModuleNav, type AttendanceModuleTab } from "@/components/layout/attendance-nav";

/**
 * The Attendance module's horizontal navigation, rendered once by `attendance/layout.tsx` so every
 * Attendance page shares it. It uses the same pill-tab look as the Issues & Corrections tabs
 * (`IssuesTabs`), which is left untouched and still sits below this bar on its own page.
 *
 * Narrow screens: each row scrolls horizontally instead of wrapping or hiding options, and its links
 * never shrink. A role with no management pages (e.g. EMPLOYEE) gets nothing rendered at all, so the
 * self-service page looks exactly as before.
 *
 * This only decides what to show — every page and service still enforces its own permission.
 */
export function AttendanceModuleNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const { tabs, secondary } = getAttendanceModuleNav(role, pathname);

  if (tabs.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Attendance</p>
      <TabRow label="Attendance" tabs={tabs} />
      {secondary && <TabRow label="Attendance settings" tabs={secondary} />}
    </div>
  );
}

function TabRow({ label, tabs }: { label: string; tabs: AttendanceModuleTab[] }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600",
            tab.active && "bg-blue-50 text-blue-700 hover:bg-blue-50",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
