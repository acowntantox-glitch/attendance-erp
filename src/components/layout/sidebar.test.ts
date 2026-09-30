import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/rbac";

// The sidebar reads the current path from Next's router; drive it from the test.
const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const { Sidebar } = await import("./sidebar");

type Anchor = { href: string; text: string; current: string | null; active: boolean };

function render(role: Role, pathname: string) {
  nav.pathname = pathname;
  const html = renderToStaticMarkup(createElement(Sidebar, { role }));
  const anchors: Anchor[] = [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/gs)].map((match) => ({
    href: /href="([^"]*)"/.exec(match[1]!)![1]!,
    text: match[2]!.replace(/<[^>]+>/g, "").trim(),
    current: /aria-current="([^"]*)"/.exec(match[1]!)?.[1] ?? null,
    active: /class="[^"]*bg-blue-50/.test(match[1]!),
  }));
  return { html, anchors, active: anchors.filter((a) => a.active).map((a) => a.text) };
}

beforeEach(() => {
  nav.pathname = "/dashboard";
});

describe("global sidebar — Attendance is a single entry", () => {
  it("has exactly one Attendance link and NONE of the module's pages as sidebar items", () => {
    const { anchors } = render("COMPANY_ADMIN", "/dashboard");
    expect(anchors.map((a) => a.text)).toEqual(["Dashboard", "Organization", "Employees", "Workforce", "Attendance", "Devices", "Reports", "Settings"]);
    expect(anchors.filter((a) => a.href.startsWith("/attendance/"))).toHaveLength(0);
    for (const removed of ["Overview", "Calendar", "Issues & Corrections", "Attendance Periods", "Attendance Policy"]) {
      expect(anchors.map((a) => a.text)).not.toContain(removed);
    }
  });

  it("the Attendance entry still goes to /attendance (self-service) for every role", () => {
    for (const role of ["COMPANY_ADMIN", "HR_ADMIN", "HR_MANAGER", "MANAGER", "EMPLOYEE"] as const) {
      const { anchors } = render(role, "/dashboard");
      expect(anchors.filter((a) => a.text === "Attendance").map((a) => a.href)).toEqual(["/attendance"]);
    }
  });

  it("has no expandable controls left over from the previous design", () => {
    const { html } = render("HR_ADMIN", "/attendance/reports");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("attendance-nav-menu");
  });

  it.each(["/attendance", "/attendance/dashboard", "/attendance/calendar", "/attendance/issues", "/attendance/reports", "/attendance/periods", "/attendance/policy"])(
    "%s → only the Attendance entry is highlighted (no duplicate active items)",
    (path) => {
      expect(render("HR_ADMIN", path).active).toEqual(["Attendance"]);
    },
  );

  it("marks /attendance as the current page; sub-pages highlight the module without claiming to be the page", () => {
    expect(render("HR_ADMIN", "/attendance").anchors.find((a) => a.text === "Attendance")!.current).toBe("page");
    expect(render("HR_ADMIN", "/attendance/reports").anchors.find((a) => a.text === "Attendance")!.current).toBeNull();
  });

  it("other sections are untouched: highlighting follows their own paths", () => {
    expect(render("HR_ADMIN", "/employees/abc").active).toEqual(["Employees"]);
    expect(render("HR_ADMIN", "/workforce/shifts").active).toEqual(["Workforce"]);
    expect(render("HR_ADMIN", "/settings").active).toEqual(["Settings"]);
  });

  it("keeps role gating of the rest of the sidebar and the My Profile link", () => {
    const employee = render("EMPLOYEE", "/attendance").anchors.map((a) => a.text);
    expect(employee).toEqual(["Dashboard", "Attendance", "Devices", "Settings", "My Profile"]);
    expect(render("HR_ADMIN", "/dashboard").anchors.map((a) => a.text)).not.toContain("My Profile");
  });

  it("uses a labelled navigation landmark and visible focus styles", () => {
    const { html } = render("HR_ADMIN", "/dashboard");
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).toContain("focus-visible:ring-2");
  });
});
