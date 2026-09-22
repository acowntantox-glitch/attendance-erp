import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/errors";
import { assertCompanyAccess, requirePermission, type RequestContext } from "./request-context";

const baseCtx: RequestContext = {
  requestId: "req-1",
  userId: "user-1",
  userEmail: "user@test.local",
  companyId: "company-a",
  role: "EMPLOYEE",
  employeeId: null,
};

describe("requirePermission", () => {
  it("throws AuthorizationError when the role lacks the permission", () => {
    expect(() => requirePermission(baseCtx, "organization.manage")).toThrow(AuthorizationError);
  });

  it("does not throw when the role has the permission", () => {
    expect(() => requirePermission({ ...baseCtx, role: "COMPANY_ADMIN" }, "organization.manage")).not.toThrow();
  });
});

describe("assertCompanyAccess", () => {
  it("throws AuthorizationError when the resource belongs to a different company", () => {
    expect(() => assertCompanyAccess(baseCtx, "company-b")).toThrow(AuthorizationError);
  });

  it("does not throw when the resource belongs to the caller's company", () => {
    expect(() => assertCompanyAccess(baseCtx, "company-a")).not.toThrow();
  });
});

describe("getRequestContext", () => {
  it("throws AuthenticationError when there is no session cookie", async () => {
    vi.resetModules();
    vi.doMock("next/headers", () => ({
      cookies: async () => ({ get: () => undefined }),
      headers: async () => ({ get: () => null }),
    }));
    vi.doMock("./session", () => ({
      SESSION_COOKIE_NAME: "session",
      validateSessionToken: vi.fn(),
    }));

    // Re-imported via vi.resetModules(), so this is a distinct module instance from the
    // statically-imported AuthenticationError above — assert on the stable `code`/httpStatus
    // shape instead of `instanceof`, which would fail across the two module instances.
    const { getRequestContext: freshGetRequestContext } = await import("./request-context");
    await expect(freshGetRequestContext()).rejects.toMatchObject({ code: "UNAUTHORIZED", httpStatus: 401 });

    vi.doUnmock("next/headers");
    vi.doUnmock("./session");
  });

  it("throws AuthenticationError when the session token does not resolve", async () => {
    vi.resetModules();
    vi.doMock("next/headers", () => ({
      cookies: async () => ({ get: () => ({ value: "some-token" }) }),
      headers: async () => ({ get: () => null }),
    }));
    vi.doMock("./session", () => ({
      SESSION_COOKIE_NAME: "session",
      validateSessionToken: vi.fn().mockResolvedValue(null),
    }));

    const { getRequestContext: freshGetRequestContext } = await import("./request-context");
    await expect(freshGetRequestContext()).rejects.toMatchObject({ code: "UNAUTHORIZED", httpStatus: 401 });

    vi.doUnmock("next/headers");
    vi.doUnmock("./session");
  });
});
