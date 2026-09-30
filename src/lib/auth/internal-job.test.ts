import { describe, expect, it } from "vitest";
import { isInternalJobAuthorized } from "./internal-job";

const SECRET = "s".repeat(40);

describe("isInternalJobAuthorized", () => {
  it("accepts the exact bearer secret", () => {
    expect(isInternalJobAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a missing header, a wrong secret, a wrong scheme, and an empty token", () => {
    expect(isInternalJobAuthorized(null, SECRET)).toBe(false);
    expect(isInternalJobAuthorized("Bearer wrong-secret", SECRET)).toBe(false);
    expect(isInternalJobAuthorized(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(isInternalJobAuthorized(SECRET, SECRET)).toBe(false);
    expect(isInternalJobAuthorized("Bearer ", SECRET)).toBe(false);
  });

  it("rejects everything when no secret is configured (endpoint disabled)", () => {
    expect(isInternalJobAuthorized(`Bearer ${SECRET}`, undefined)).toBe(false);
    expect(isInternalJobAuthorized("Bearer ", "")).toBe(false);
  });

  it("does not throw on a presented token of a different length", () => {
    expect(isInternalJobAuthorized(`Bearer ${SECRET}extra`, SECRET)).toBe(false);
    expect(isInternalJobAuthorized("Bearer x", SECRET)).toBe(false);
  });

  it("accepts any one of several configured secrets (INTERNAL_JOB_SECRET or Vercel's CRON_SECRET)", () => {
    const cron = "c".repeat(20);
    expect(isInternalJobAuthorized(`Bearer ${cron}`, SECRET, cron)).toBe(true);
    expect(isInternalJobAuthorized(`Bearer ${SECRET}`, SECRET, cron)).toBe(true);
    expect(isInternalJobAuthorized("Bearer other", SECRET, cron)).toBe(false);
  });

  it("ignores unset secrets in the list, and authorizes nothing when none is configured", () => {
    expect(isInternalJobAuthorized(`Bearer ${SECRET}`, undefined, SECRET)).toBe(true);
    expect(isInternalJobAuthorized(`Bearer ${SECRET}`, undefined, undefined)).toBe(false);
    expect(isInternalJobAuthorized(`Bearer ${SECRET}`)).toBe(false);
  });
});
