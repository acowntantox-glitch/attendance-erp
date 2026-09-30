import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/rbac";

const nav = vi.hoisted(() => ({ pathname: "/attendance/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const { AttendanceModuleNav } = await import("./attendance-module-nav");
const { IssuesTabs } = await import("./issues/issues-tabs");

type Link = { href: string; text: string; current: string | null; active: boolean };
type Row = { label: string | null; links: Link[]; classes: string };

function parse(html: string) {
  const rows: Row[] = [...html.matchAll(/<nav\b([^>]*)>(.*?)<\/nav>/gs)].map((nv) => ({
    label: /aria-label="([^"]*)"/.exec(nv[1]!)?.[1] ?? null,
    classes: /class="([^"]*)"/.exec(nv[1]!)?.[1] ?? "",
    links: [...nv[2]!.matchAll(/<a\b([^>]*)>(.*?)<\/a>/gs)].map((a) => ({
      href: /href="([^"]*)"/.exec(a[1]!)![1]!,
      text: a[2]!.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim(),
      current: /aria-current="([^"]*)"/.exec(a[1]!)?.[1] ?? null,
      active: /class="[^"]*bg-blue-50/.test(a[1]!),
    })),
  }));
  return { rows, primary: rows.find((r) => r.label === "Attendance"), secondary: rows.find((r) => r.label === "Attendance settings") };
}

function render(role: Role, pathname: string) {
  nav.pathname = pathname;
  const html = renderToStaticMarkup(createElement(AttendanceModuleNav, { role }));
  return { html, ...parse(html) };
}

beforeEach(() => {
  nav.pathname = "/attendance/dashboard";
});

describe("Attendance horizontal navigation — markup", () => {
  it("renders the five tabs in order for a management role, linking the unchanged URLs", () => {
    const { primary } = render("HR_ADMIN", "/attendance/dashboard");
    expect(primary!.links.map((l) => l.text)).toEqual(["Overview", "Calendar", "Issues & Corrections", "Reports", "Settings"]);
    expect(primary!.links.map((l) => l.href)).toEqual([
      "/attendance/dashboard",
      "/attendance/calendar",
      "/attendance/issues",
      "/attendance/reports",
      "/attendance/periods",
    ]);
  });

  it.each([
    ["/attendance/dashboard", "Overview"],
    ["/attendance/calendar", "Calendar"],
    ["/attendance/issues", "Issues & Corrections"],
    ["/attendance/reports", "Reports"],
    ["/attendance/periods", "Settings"],
    ["/attendance/policy", "Settings"],
  ])("%s → %s is the ONLY active/current tab", (path, expected) => {
    const { primary } = render("COMPANY_ADMIN", path);
    expect(primary!.links.filter((l) => l.active).map((l) => l.text)).toEqual([expected]);
    expect(primary!.links.filter((l) => l.current === "page").map((l) => l.text)).toEqual([expected]);
  });

  it("shows the second row only inside Settings, with Periods/Policy and the right one active", () => {
    for (const [path, expected] of [
      ["/attendance/periods", "Attendance Periods"],
      ["/attendance/policy", "Attendance Policy"],
    ] as const) {
      const { secondary } = render("COMPANY_ADMIN", path);
      expect(secondary!.links.map((l) => l.text)).toEqual(["Attendance Periods", "Attendance Policy"]);
      expect(secondary!.links.map((l) => l.href)).toEqual(["/attendance/periods", "/attendance/policy"]);
      expect(secondary!.links.filter((l) => l.current === "page").map((l) => l.text)).toEqual([expected]);
      expect(secondary!.links.filter((l) => l.active).map((l) => l.text)).toEqual([expected]);
    }
    for (const path of ["/attendance/dashboard", "/attendance/calendar", "/attendance/issues", "/attendance/reports", "/attendance"]) {
      expect(render("COMPANY_ADMIN", path).secondary).toBeUndefined();
    }
  });

  it("/attendance (My Attendance) shows the bar for management roles with no tab active", () => {
    const { primary } = render("HR_ADMIN", "/attendance");
    expect(primary!.links).toHaveLength(5);
    expect(primary!.links.some((l) => l.active || l.current)).toBe(false);
  });
});

describe("Attendance horizontal navigation — role visibility", () => {
  it("EMPLOYEE gets no management navigation at all — the self-service page is unchanged", () => {
    const { html, rows } = render("EMPLOYEE", "/attendance");
    expect(html).toBe("");
    expect(rows).toHaveLength(0);
  });

  it("MANAGER sees Overview only", () => {
    expect(render("MANAGER", "/attendance/dashboard").primary!.links.map((l) => l.text)).toEqual(["Overview"]);
  });

  it("HR_MANAGER sees no Attendance Periods; Settings points at Policy and there is no one-item second row", () => {
    const { primary, secondary } = render("HR_MANAGER", "/attendance/policy");
    expect(primary!.links.map((l) => l.text)).toEqual(["Overview", "Calendar", "Issues & Corrections", "Reports", "Settings"]);
    expect(primary!.links.find((l) => l.text === "Settings")).toMatchObject({ href: "/attendance/policy", active: true });
    expect(secondary).toBeUndefined();
  });

  it("no role is shown a link to a page it could not reach before", () => {
    const hrefs = (role: Role) => (render(role, "/attendance/periods").primary?.links ?? []).map((l) => l.href);
    expect(hrefs("MANAGER")).not.toContain("/attendance/reports");
    expect(hrefs("MANAGER")).not.toContain("/attendance/issues");
    expect(hrefs("HR_MANAGER")).not.toContain("/attendance/periods");
    expect(hrefs("EMPLOYEE")).toEqual([]);
  });
});

describe("Attendance horizontal navigation — accessibility and responsive safety", () => {
  it("uses labelled <nav> landmarks, real links, and aria-current on the active item", () => {
    const { html, rows } = render("COMPANY_ADMIN", "/attendance/periods");
    expect(rows.map((r) => r.label)).toEqual(["Attendance", "Attendance settings"]);
    expect(html).not.toMatch(/<div[^>]*onclick/i);
    expect(html.match(/aria-current="page"/g)).toHaveLength(2); // one per row
  });

  it("has visible keyboard focus styling on every link", () => {
    const { html, primary } = render("COMPANY_ADMIN", "/attendance/dashboard");
    expect(html.match(/focus-visible:ring-2/g)).toHaveLength(primary!.links.length);
  });

  it("scrolls horizontally on narrow screens instead of wrapping or hiding options; links never shrink", () => {
    const { html, primary } = render("COMPANY_ADMIN", "/attendance/dashboard");
    expect(primary!.classes).toContain("overflow-x-auto");
    expect(primary!.classes).not.toContain("flex-wrap");
    expect(html.match(/shrink-0 whitespace-nowrap/g)).toHaveLength(primary!.links.length);
    expect(primary!.links).toHaveLength(5); // nothing hidden at any width
  });
});

describe("Issues & Corrections' own tabs are unchanged", () => {
  it("still renders exactly [ All ] [ Exceptions ] [ Correction Requests ] with the same URLs and active state", () => {
    const html = renderToStaticMarkup(createElement(IssuesTabs, { tabs: ["all", "exceptions", "corrections"], active: "exceptions" }));
    const { rows } = parse(html);
    expect(rows[0]!.label).toBe("Issues and corrections");
    expect(rows[0]!.links.map((l) => l.text)).toEqual(["All", "Exceptions", "Correction Requests"]);
    expect(rows[0]!.links.map((l) => l.href)).toEqual([
      "/attendance/issues?tab=all",
      "/attendance/issues?tab=exceptions",
      "/attendance/issues?tab=corrections",
    ]);
    expect(rows[0]!.links.filter((l) => l.current === "page").map((l) => l.text)).toEqual(["Exceptions"]);
  });

  it("is a distinct landmark from the module bar, so the two levels never merge", () => {
    const issues = parse(renderToStaticMarkup(createElement(IssuesTabs, { tabs: ["all", "exceptions", "corrections"], active: "all" }))).rows[0]!;
    const moduleBar = render("COMPANY_ADMIN", "/attendance/issues").primary!;
    expect(issues.label).not.toBe(moduleBar.label);
    expect(moduleBar.links.map((l) => l.text)).not.toContain("Exceptions");
  });
});
