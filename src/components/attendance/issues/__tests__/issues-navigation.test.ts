import { describe, expect, it } from "vitest";
import { ROLES } from "@/lib/auth/rbac";
import {
  availableIssuesTabs,
  issuesTabHref,
  legacyRedirectUrl,
  resolveIssuesAccess,
  resolveIssuesTab,
} from "../issues-navigation";

describe("resolveIssuesAccess (mirrors the two unchanged RBAC permissions)", () => {
  it("HR_ADMIN, HR_MANAGER and the admin roles can use both halves", () => {
    for (const role of ["SUPER_ADMIN", "COMPANY_ADMIN", "HR_ADMIN", "HR_MANAGER"] as const) {
      expect(resolveIssuesAccess(role)).toEqual({ exceptions: true, corrections: true });
    }
  });

  it("MANAGER and EMPLOYEE can use neither half (no new access is granted)", () => {
    expect(resolveIssuesAccess("MANAGER")).toEqual({ exceptions: false, corrections: false });
    expect(resolveIssuesAccess("EMPLOYEE")).toEqual({ exceptions: false, corrections: false });
  });

  it("every role resolves to a defined access shape", () => {
    for (const role of ROLES) {
      const access = resolveIssuesAccess(role);
      expect(typeof access.exceptions).toBe("boolean");
      expect(typeof access.corrections).toBe("boolean");
    }
  });
});

describe("availableIssuesTabs / resolveIssuesTab", () => {
  const both = { exceptions: true, corrections: true };
  const onlyExceptions = { exceptions: true, corrections: false };
  const onlyCorrections = { exceptions: false, corrections: true };
  const neither = { exceptions: false, corrections: false };

  it("offers All + both tabs when both halves are available, a single tab otherwise, none for neither", () => {
    expect(availableIssuesTabs(both)).toEqual(["all", "exceptions", "corrections"]);
    expect(availableIssuesTabs(onlyExceptions)).toEqual(["exceptions"]);
    expect(availableIssuesTabs(onlyCorrections)).toEqual(["corrections"]);
    expect(availableIssuesTabs(neither)).toEqual([]);
  });

  it("honours a requested tab that is available", () => {
    expect(resolveIssuesTab("exceptions", both)).toBe("exceptions");
    expect(resolveIssuesTab("corrections", both)).toBe("corrections");
    expect(resolveIssuesTab("all", both)).toBe("all");
  });

  it("defaults to All when both are available and nothing valid is requested", () => {
    expect(resolveIssuesTab(undefined, both)).toBe("all");
    expect(resolveIssuesTab("nonsense", both)).toBe("all");
  });

  it("never lets a request bypass authorization: an unavailable tab falls back to the permitted one", () => {
    expect(resolveIssuesTab("corrections", onlyExceptions)).toBe("exceptions");
    expect(resolveIssuesTab("exceptions", onlyCorrections)).toBe("corrections");
    expect(resolveIssuesTab("all", onlyExceptions)).toBe("exceptions");
  });

  it("returns null when the role can use neither half", () => {
    expect(resolveIssuesTab("exceptions", neither)).toBeNull();
    expect(resolveIssuesTab(undefined, neither)).toBeNull();
  });
});

describe("issuesTabHref", () => {
  it("builds the workspace URL for a tab, dropping empty extras", () => {
    expect(issuesTabHref("exceptions")).toBe("/attendance/issues?tab=exceptions");
    expect(issuesTabHref("corrections", { status: "PENDING", page: undefined })).toBe("/attendance/issues?tab=corrections&status=PENDING");
  });
});

describe("legacyRedirectUrl (old bookmarks keep working)", () => {
  it("/attendance/exceptions -> the Exceptions tab, carrying every filter, including repeated keys", () => {
    const url = legacyRedirectUrl("exceptions", {
      fromDate: "2026-04-01",
      toDate: "2026-04-07",
      types: ["LATE", "ABSENT"],
      includeDismissed: "true",
      page: "2",
    });
    expect(url.startsWith("/attendance/issues?tab=exceptions&")).toBe(true);
    const params = new URL(url, "http://x").searchParams;
    expect(params.get("fromDate")).toBe("2026-04-01");
    expect(params.get("toDate")).toBe("2026-04-07");
    expect(params.getAll("types")).toEqual(["LATE", "ABSENT"]);
    expect(params.get("includeDismissed")).toBe("true");
    expect(params.get("page")).toBe("2");
  });

  it("/attendance/corrections -> the Correction Requests tab, carrying the status filter", () => {
    expect(legacyRedirectUrl("corrections", {})).toBe("/attendance/issues?tab=corrections");
    expect(legacyRedirectUrl("corrections", { status: "APPROVED" })).toBe("/attendance/issues?tab=corrections&status=APPROVED");
  });

  it("ignores undefined values and never lets an incoming tab override the destination tab", () => {
    expect(legacyRedirectUrl("exceptions", { search: undefined, tab: "corrections" })).toBe("/attendance/issues?tab=exceptions");
  });
});
