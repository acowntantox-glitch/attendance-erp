import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";

const hdrs = vi.hoisted(() => ({ mode: "id" as "id" | "none" | "throw" }));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (hdrs.mode === "throw") throw new Error("headers() was called outside a request scope");
    return { get: (name: string) => (hdrs.mode === "id" && name === "x-request-id" ? "proxy-request-id-123" : null) };
  },
}));

const { withApiHandler } = await import("./response");

describe("withApiHandler request id (F-15)", () => {
  it("echoes the id the proxy stamped on the request, so an error can be traced to its audit trail", async () => {
    hdrs.mode = "id";
    let seen: string | undefined;
    const handler = withApiHandler(async (requestId: string) => {
      seen = requestId;
      throw new ValidationError("bad input");
    });
    const response = await handler();
    const body = await response.json();
    expect(seen).toBe("proxy-request-id-123");
    expect(body.error).toMatchObject({ code: "VALIDATION_ERROR", requestId: "proxy-request-id-123" });
    expect(response.status).toBe(400);
  });

  it("generates one when there is no proxy id or no request scope", async () => {
    for (const mode of ["none", "throw"] as const) {
      hdrs.mode = mode;
      const handler = withApiHandler(async (requestId: string) => Response.json({ requestId }));
      const body = await (await handler()).json();
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("an unexpected error returns the generic envelope with no internals", async () => {
    hdrs.mode = "id";
    const handler = withApiHandler(async () => {
      throw new Error('connection to postgres://user:secret@host/db failed: select * from employees');
    });
    const response = await handler();
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("postgres://");
    expect(text).not.toContain("select *");
    expect(JSON.parse(text).error).toMatchObject({ code: "INTERNAL_ERROR", requestId: "proxy-request-id-123" });
  });
});
