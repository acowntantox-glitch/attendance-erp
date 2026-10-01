import { describe, expect, it } from "vitest";
import { createPool } from "./pool";

describe("database pool (F-14)", () => {
  it("handles errors on idle clients (otherwise Node treats them as uncaught exceptions) and bounds waiting for a connection", async () => {
    const pool = createPool("postgresql://user:password@localhost:5432/unused"); // never connects: no query is made
    try {
      expect(pool.listenerCount("error")).toBeGreaterThan(0);
      expect(pool.options.connectionTimeoutMillis).toBeGreaterThan(0);
      expect(pool.options.idleTimeoutMillis).toBeGreaterThan(0);
      expect(pool.options.max).toBe(10);
    } finally {
      await pool.end();
    }
  });
});
