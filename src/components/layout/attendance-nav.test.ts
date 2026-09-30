import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/auth/rbac";
import { getAttendanceModuleNav, getAttendanceNav, isActivePath } from "./attendance-nav";

const hrefs = (role: Role) => {
  const nav = getAttendanceNav(role);
  return { items: nav.items.map((l) => l.href), settings: nav.settings.map((l) => l.href) };
};

describe("getAttendanceNav — same visibility rules as before the regrouping", () => {
  it("HR_ADMIN and the admin roles see the full structure, in the intended order", () => {
    for (const role of ["HR_ADMIN", "COMPANY_ADMIN", "SUPER_ADMIN"] as const) {
      expect(getAttendanceNav(role)).toEqual({
        items: [
          { href: "/attendance/dashboard", label: "Overview" },
          { href: "/attendance/calendar", label: "Calendar" },
          { href: "/attendance/issues", label: "Issues & Corrections" },
          { href: "/attendance/reports", label: "Reports" },
        ],
        settings: [
          { href: "/attendance/periods", label: "Attendance Periods" },
          { href: "/attendance/policy", label: "Attendance Policy" },
        ],
      });
    }
  });

  it("HR_MANAGER: everything except Attendance Periods (needs period lock/unlock)", () => {
    expect(hrefs("HR_MANAGER")).toEqual({
      items: ["/attendance/dashboard", "/attendance/calendar", "/attendance/issues", "/attendance/reports"],
      settings: ["/attendance/policy"],
    });
  });

  it("MANAGER sees only the overview — no calendar/issues/reports/settings", () => {
    expect(hrefs("MANAGER")).toEqual({ items: ["/attendance/dashboard"], settings: [] });
  });

  it("EMPLOYEE gets no management links at all (only the self-service page, outside this list)", () => {
    expect(hrefs("EMPLOYEE")).toEqual({ items: [], settings: [] });
  });

  it("keeps every existing route unchanged — nothing renamed or redirected", () => {
    const all = new Set([...hrefs("COMPANY_ADMIN").items, ...hrefs("COMPANY_ADMIN").settings]);
    expect([...all].sort()).toEqual(
      ["/attendance/calendar", "/attendance/dashboard", "/attendance/issues", "/attendance/periods", "/attendance/policy", "/attendance/reports"].sort(),
    );
  });

  it("never grants a link a role could not see before: every entry maps to the permission the old sidebar used", async () => {
    const { can } = await import("@/lib/auth/rbac");
    for (const role of ROLES) {
      const { items, settings } = getAttendanceNav(role);
      const shown = new Set([...items, ...settings].map((l) => l.href));
      expect(shown.has("/attendance/dashboard")).toBe(role !== "EMPLOYEE" && can(role, "attendance.view"));
      expect(shown.has("/attendance/calendar")).toBe(can(role, "attendance.report.view"));
      expect(shown.has("/attendance/reports")).toBe(can(role, "attendance.report.view"));
      expect(shown.has("/attendance/issues")).toBe(can(role, "attendance.report.view") || can(role, "attendance.correction.approve"));
      expect(shown.has("/attendance/periods")).toBe(can(role, "attendance.period.lock") || can(role, "attendance.period.unlock"));
      expect(shown.has("/attendance/policy")).toBe(can(role, "attendance.policy.view"));
    }
  });
});

describe("isActivePath", () => {
  it("matches the exact path and true sub-paths only", () => {
    expect(isActivePath("/attendance/issues", "/attendance/issues")).toBe(true);
    expect(isActivePath("/attendance/issues/anything", "/attendance/issues")).toBe(true);
    expect(isActivePath("/attendance/issues-old", "/attendance/issues")).toBe(false);
    expect(isActivePath("/attendance-old", "/attendance")).toBe(false);
    expect(isActivePath("/attendance/calendar", "/attendance")).toBe(true);
    expect(isActivePath("/employees/1/attendance", "/attendance")).toBe(false);
  });
});

describe("getAttendanceModuleNav — the horizontal bar", () => {
  const labels = (tabs: { label: string }[]) => tabs.map((t) => t.label);
  const activeLabels = (tabs: { label: string; active: boolean }[]) => tabs.filter((t) => t.active).map((t) => t.label);

  it("shows Overview, Calendar, Issues & Corrections, Reports, Settings for a full administrator", () => {
    const { tabs } = getAttendanceModuleNav("HR_ADMIN", "/attendance/dashboard");
    expect(labels(tabs)).toEqual(["Overview", "Calendar", "Issues & Corrections", "Reports", "Settings"]);
    expect(tabs.map((t) => t.href)).toEqual([
      "/attendance/dashboard",
      "/attendance/calendar",
      "/attendance/issues",
      "/attendance/reports",
      "/attendance/periods", // Settings opens the first Settings page the role may use
    ]);
  });

  it.each([
    ["/attendance/dashboard", "Overview"],
    ["/attendance/calendar", "Calendar"],
    ["/attendance/issues", "Issues & Corrections"],
    ["/attendance/reports", "Reports"],
    ["/attendance/periods", "Settings"],
    ["/attendance/policy", "Settings"],
  ])("%s → exactly one active tab: %s", (path, expected) => {
    const { tabs } = getAttendanceModuleNav("COMPANY_ADMIN", path);
    expect(activeLabels(tabs)).toEqual([expected]);
  });

  it("the self-service page (/attendance) and unrelated paths activate NO tab (no broad /attendance match)", () => {
    for (const path of ["/attendance", "/dashboard", "/employees/1/attendance", "/attendance-old"]) {
      expect(activeLabels(getAttendanceModuleNav("COMPANY_ADMIN", path).tabs)).toEqual([]);
    }
  });

  it("sub-paths keep their tab active (e.g. a deep link under Issues)", () => {
    expect(activeLabels(getAttendanceModuleNav("COMPANY_ADMIN", "/attendance/issues/anything").tabs)).toEqual(["Issues & Corrections"]);
  });

  it("the secondary row (Attendance Periods | Attendance Policy) appears ONLY inside Settings, with the right item active", () => {
    expect(getAttendanceModuleNav("COMPANY_ADMIN", "/attendance/dashboard").secondary).toBeNull();
    expect(getAttendanceModuleNav("COMPANY_ADMIN", "/attendance/reports").secondary).toBeNull();

    const periods = getAttendanceModuleNav("COMPANY_ADMIN", "/attendance/periods").secondary!;
    expect(labels(periods)).toEqual(["Attendance Periods", "Attendance Policy"]);
    expect(activeLabels(periods)).toEqual(["Attendance Periods"]);

    const policy = getAttendanceModuleNav("COMPANY_ADMIN", "/attendance/policy").secondary!;
    expect(activeLabels(policy)).toEqual(["Attendance Policy"]);
  });

  it("HR_MANAGER: Settings opens Policy (the only page they may use) and there is no pointless one-item second row", () => {
    const { tabs, secondary } = getAttendanceModuleNav("HR_MANAGER", "/attendance/policy");
    expect(tabs.find((t) => t.label === "Settings")).toMatchObject({ href: "/attendance/policy", active: true });
    expect(secondary).toBeNull();
    expect(labels(tabs)).toEqual(["Overview", "Calendar", "Issues & Corrections", "Reports", "Settings"]);
  });

  it("MANAGER sees only Overview; EMPLOYEE gets no bar at all (self-service is untouched)", () => {
    expect(labels(getAttendanceModuleNav("MANAGER", "/attendance").tabs)).toEqual(["Overview"]);
    expect(getAttendanceModuleNav("EMPLOYEE", "/attendance")).toEqual({ tabs: [], secondary: null });
  });

  it("never offers a tab the role could not open before (same rules as the visibility matrix)", () => {
    for (const role of ROLES) {
      const shown = new Set(getAttendanceModuleNav(role, "/attendance/periods").tabs.map((t) => t.href));
      const nav = getAttendanceNav(role);
      for (const link of nav.items) expect(shown.has(link.href)).toBe(true);
      expect(shown.size).toBe(nav.items.length + (nav.settings.length > 0 ? 1 : 0));
    }
  });
});
