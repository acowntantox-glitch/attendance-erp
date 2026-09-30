"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/auth/rbac";
import { getAttendanceModuleNav, type AttendanceModuleTab } from "@/components/layout/attendance-nav";
import { TabLabel, tabLinkClass, tabListClass, type TabTier } from "./attendance-tab-styles";

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
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Attendance</p>
      <TabRow label="Attendance" tabs={tabs} tier="primary" />
      {secondary && <TabRow label="Attendance settings" tabs={secondary} tier="secondary" />}
    </div>
  );
}

function TabRow({ label, tabs, tier }: { label: string; tabs: AttendanceModuleTab[]; tier: TabTier }) {
  return (
    <nav aria-label={label} className={tabListClass(tier)}>
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={tab.active ? "page" : undefined} className={tabLinkClass(tier, tab.active)}>
          <TabLabel>{tab.label}</TabLabel>
        </Link>
      ))}
    </nav>
  );
}
