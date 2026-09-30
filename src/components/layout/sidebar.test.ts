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

  const anchors: Anchor[] = [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/gs)].map((match) => {
    const attrs = match[1]!;
    return {
      href: /href="([^"]*)"/.exec(attrs)![1]!,
      text: match[2]!.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim(),
      current: /aria-current="([^"]*)"/.exec(attrs)?.[1] ?? null,
      active: /class="[^"]*bg-blue-50/.test(attrs),
    };
  });
  const buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map((match) => ({
    expanded: /aria-expanded="([^"]*)"/.exec(match[1]!)?.[1] ?? null,
    controls: /aria-controls="([^"]*)"/.exec(match[1]!)?.[1] ?? null,
    label: /aria-label="([^"]*)"/.exec(match[1]!)?.[1] ?? null,
  }));
  const panelHidden = (id: string) => new RegExp(`<ul id="${id}"[^>]*\\bhidden`).test(html);
  return { html, anchors, buttons, panelHidden, link: (href: string) => anchors.find((a) => a.href === href) };
}

beforeEach(() => {
  nav.pathname = "/dashboard";
});

describe("Attendance navigation group", () => {
  it("presents Attendance as ONE module with the intended order, and no stray top-level attendance links", () => {
    const { anchors } = render("HR_ADMIN", "/dashboard");
    const labels = anchors.map((a) => a.text);
    expect(labels).toEqual([
      "Dashboard",
      "Organization",
      "Employees",
      "Workforce",
      "Attendance",
      "Overview",
      "Calendar",
      "Issues & Corrections",
      "Reports", // attendance Reports (module child)
      "Attendance Periods",
      "Attendance Policy",
      "Devices",
      "Reports", // global Reports
      "Settings", // global account Settings
    ]);
  });

  it("collapsed and inactive outside the module", () => {
    const { buttons, panelHidden, link } = render("HR_ADMIN", "/dashboard");
    const attendance = buttons.find((b) => b.controls === "attendance-nav-menu")!;
    expect(attendance.expanded).toBe("false");
    expect(panelHidden("attendance-nav-menu")).toBe(true);
    expect(link("/attendance")!.active).toBe(false);
  });

  it.each([
    ["/attendance/dashboard", "Overview"],
    ["/attendance/calendar", "Calendar"],
    ["/attendance/issues", "Issues & Corrections"],
    ["/attendance/reports", "Reports"],
  ])("%s → module expanded, parent active, only %s is the current page", (path, label) => {
    const { buttons, panelHidden, anchors, link } = render("HR_ADMIN", path);
    expect(buttons.find((b) => b.controls === "attendance-nav-menu")!.expanded).toBe("true");
    expect(panelHidden("attendance-nav-menu")).toBe(false);
    expect(link("/attendance")!.active).toBe(true); // module stays visually active
    expect(link("/attendance")!.current).toBeNull(); // ...but is not "the current page"

    const current = anchors.filter((a) => a.current === "page" && a.href.startsWith("/attendance"));
    expect(current.map((a) => a.text)).toEqual([label]);
    // The nested Settings section stays collapsed.
    expect(panelHidden("attendance-settings-menu")).toBe(true);
  });

  it.each([
    ["/attendance/periods", "Attendance Periods"],
    ["/attendance/policy", "Attendance Policy"],
  ])("%s → module AND Settings expanded, %s active", (path, label) => {
    const { buttons, panelHidden, anchors, link } = render("HR_ADMIN", path);
    expect(buttons.find((b) => b.controls === "attendance-nav-menu")!.expanded).toBe("true");
    expect(buttons.find((b) => b.controls === "attendance-settings-menu")!.expanded).toBe("true");
    expect(panelHidden("attendance-nav-menu")).toBe(false);
    expect(panelHidden("attendance-settings-menu")).toBe(false);
    expect(link("/attendance")!.active).toBe(true);
    expect(anchors.filter((a) => a.current === "page" && a.href.startsWith("/attendance")).map((a) => a.text)).toEqual([label]);
  });

  it("/attendance (My Attendance) keeps the module expanded and the parent link is the current page", () => {
    const { link, buttons } = render("HR_ADMIN", "/attendance");
    expect(link("/attendance")).toMatchObject({ active: true, current: "page" });
    expect(buttons.find((b) => b.controls === "attendance-nav-menu")!.expanded).toBe("true");
  });

  it("only one attendance page is ever the current page (no double highlight of siblings)", () => {
    const { anchors } = render("HR_ADMIN", "/attendance/issues");
    const highlighted = anchors.filter((a) => a.active && a.href.startsWith("/attendance/") && a.href !== "/attendance");
    expect(highlighted.map((a) => a.href)).toEqual(["/attendance/issues"]);
  });

  it("has accessible expandable controls: buttons with aria-expanded/aria-controls that point at real panels", () => {
    const { html, buttons } = render("HR_ADMIN", "/attendance/reports");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.expanded).toMatch(/^(true|false)$/);
      expect(html).toContain(`id="${button.controls}"`);
    }
    expect(buttons[0]!.label).toBe("Attendance menu");
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).toContain("focus-visible:ring-2");
  });
});

describe("Attendance navigation — role visibility (UI only; pages/services still enforce)", () => {
  it("EMPLOYEE gets just the Attendance link: no chevron, no management links, still reaches /attendance", () => {
    const { anchors, buttons, html } = render("EMPLOYEE", "/attendance");
    expect(buttons).toHaveLength(0);
    expect(anchors.some((a) => a.href === "/attendance")).toBe(true);
    expect(anchors.filter((a) => a.href.startsWith("/attendance/"))).toHaveLength(0);
    expect(html).not.toContain("attendance-nav-menu");
  });

  it("MANAGER sees the Overview only — no Settings section", () => {
    const { anchors, buttons } = render("MANAGER", "/dashboard");
    expect(anchors.filter((a) => a.href.startsWith("/attendance/")).map((a) => a.text)).toEqual(["Overview"]);
    expect(buttons.map((b) => b.controls)).toEqual(["attendance-nav-menu"]);
  });

  it("HR_MANAGER sees Policy but not Attendance Periods under Settings", () => {
    const { anchors } = render("HR_MANAGER", "/dashboard");
    const attendanceLinks = anchors.filter((a) => a.href.startsWith("/attendance/")).map((a) => a.text);
    expect(attendanceLinks).toEqual(["Overview", "Calendar", "Issues & Corrections", "Reports", "Attendance Policy"]);
  });

  it("all six existing URLs are still linked for a full administrator (no route was renamed)", () => {
    const { anchors } = render("COMPANY_ADMIN", "/dashboard");
    const hrefs = anchors.map((a) => a.href);
    for (const href of ["/attendance/dashboard", "/attendance/calendar", "/attendance/issues", "/attendance/reports", "/attendance/periods", "/attendance/policy"]) {
      expect(hrefs).toContain(href);
    }
  });
});
