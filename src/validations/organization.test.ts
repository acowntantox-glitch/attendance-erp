import { describe, expect, it } from "vitest";
import { createBranchSchema, createDepartmentSchema, createLocationSchema } from "./organization";

describe("organization validations", () => {
  it("accepts a valid branch payload", () => {
    const result = createBranchSchema.safeParse({ name: "Head Office", code: "HQ" });
    expect(result.success).toBe(true);
  });

  it("rejects a lowercase branch code", () => {
    const result = createBranchSchema.safeParse({ name: "Head Office", code: "hq" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty department name", () => {
    const result = createDepartmentSchema.safeParse({ name: "", code: "HR" });
    expect(result.success).toBe(false);
  });

  it("rejects out-of-range coordinates", () => {
    const result = createLocationSchema.safeParse({
      branchId: "8f14e45f-ceea-467e-adc0-fbc1b9f4a1f0",
      name: "HQ",
      latitude: 999,
      longitude: 55.27,
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid coordinates", () => {
    const result = createLocationSchema.safeParse({
      branchId: "8f14e45f-ceea-467e-adc0-fbc1b9f4a1f0",
      name: "HQ",
      latitude: 25.2,
      longitude: 55.27,
    });
    expect(result.success).toBe(true);
  });
});
