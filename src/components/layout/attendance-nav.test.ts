import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/auth/rbac";
import { getAttendanceNav, isActivePath, resolveGroupOpen } from "./attendance-nav";

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

describe("resolveGroupOpen", () => {
  it("uses the automatic state when the user has not toggled", () => {
    expect(resolveGroupOpen(true, null, "/attendance/calendar")).toBe(true);
    expect(resolveGroupOpen(false, null, "/dashboard")).toBe(false);
  });

  it("honours a manual toggle on the page it was made on", () => {
    expect(resolveGroupOpen(true, { path: "/attendance/calendar", open: false }, "/attendance/calendar")).toBe(false);
    expect(resolveGroupOpen(false, { path: "/dashboard", open: true }, "/dashboard")).toBe(true);
  });

  it("returns to the automatic state after navigating — being inside Attendance always shows it expanded", () => {
    const collapsedOnCalendar = { path: "/attendance/calendar", open: false };
    expect(resolveGroupOpen(true, collapsedOnCalendar, "/attendance/issues")).toBe(true);
    expect(resolveGroupOpen(false, { path: "/dashboard", open: true }, "/employees")).toBe(false);
  });
});
