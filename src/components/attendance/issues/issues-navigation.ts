import { can, type Role } from "@/lib/auth/rbac";

/**
 * Pure navigation/authorization helpers for the unified "Issues & Corrections" workspace. Nothing
 * here is a security boundary — every tab's data comes from a service that re-checks its own
 * permission — this only decides what to SHOW so a role never sees a tab it cannot use.
 */
export const ISSUES_BASE_PATH = "/attendance/issues";

export type IssuesTab = "all" | "exceptions" | "corrections";

/** The two existing, unchanged permissions that gate the two halves of the workspace. */
export function resolveIssuesAccess(role: Role): { exceptions: boolean; corrections: boolean } {
  return {
    exceptions: can(role, "attendance.report.view"),
    corrections: can(role, "attendance.correction.approve"),
  };
}

/** "All" only makes sense when both halves are available; otherwise the single permitted tab. */
export function availableIssuesTabs(access: { exceptions: boolean; corrections: boolean }): IssuesTab[] {
  if (access.exceptions && access.corrections) return ["all", "exceptions", "corrections"];
  if (access.exceptions) return ["exceptions"];
  if (access.corrections) return ["corrections"];
  return [];
}

/**
 * The tab to render: the requested one if it is available to this role, otherwise the first
 * available tab. An unavailable or unknown request never bypasses authorization — it falls back.
 * `null` means the role can use neither half.
 */
export function resolveIssuesTab(requested: string | undefined, access: { exceptions: boolean; corrections: boolean }): IssuesTab | null {
  const tabs = availableIssuesTabs(access);
  if (tabs.length === 0) return null;
  return tabs.find((tab) => tab === requested) ?? tabs[0]!;
}

/** A tab's URL, optionally with extra query parameters (undefined/empty values are dropped). */
export function issuesTabHref(tab: IssuesTab, extra: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams({ tab });
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
  }
  return `${ISSUES_BASE_PATH}?${params.toString()}`;
}

/**
 * Where a legacy `/attendance/exceptions` or `/attendance/corrections` URL goes: the same
 * query string (filters, pagination, status) is carried over onto the matching tab, so bookmarks
 * and shared links keep their meaning. Repeated keys (e.g. `types`) are preserved.
 */
export function legacyRedirectUrl(tab: "exceptions" | "corrections", searchParams: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams({ tab });
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "tab" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return `${ISSUES_BASE_PATH}?${params.toString()}`;
}
