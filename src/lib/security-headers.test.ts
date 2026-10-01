import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("baseline response headers (F-14)", () => {
  it("sets clickjacking, sniffing, referrer and permissions headers on every route", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    const headers = Object.fromEntries(all!.headers.map((h) => [h.key, h.value]));
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });
});
