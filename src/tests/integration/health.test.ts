import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns a status field with 200 (db reachable) or 503 (db unreachable)", async () => {
    const response = await GET();
    const body = await response.json();
    expect([200, 503]).toContain(response.status);
    expect(["ok", "error"]).toContain(body.status);
  });
});
