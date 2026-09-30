import { and, inArray, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/db/client";
import { authRateLimits } from "@/db/schema";

/**
 * Persistence for the fixed-window failure counters. All time arithmetic uses the database clock
 * (`now()`), so multiple serverless instances agree and there is no dependency on app-server clocks.
 */
export const rateLimitRepository = {
  /** Current in-window failure counts for the given keys — ONE query. Keys whose window has already
   *  ended are simply absent, which is how a block expires by itself. */
  async findActive(keys: string[], windowSeconds: number, executor: DbExecutor = db): Promise<Map<string, number>> {
    if (keys.length === 0) return new Map();
    const rows = await executor
      .select({ key: authRateLimits.key, attempts: authRateLimits.attempts })
      .from(authRateLimits)
      .where(and(inArray(authRateLimits.key, keys), sql`${authRateLimits.windowStart} > now() - make_interval(secs => ${windowSeconds})`));
    return new Map(rows.map((row) => [row.key, row.attempts]));
  },

  /**
   * Records one failure atomically and returns the attempt count in the current window. If the
   * previous window has ended the counter restarts at 1 — in the same statement, so concurrent
   * failures neither lose an increment nor race on the window reset.
   */
  async recordFailure(key: string, windowSeconds: number, executor: DbExecutor = db): Promise<number> {
    const result = await executor.execute<{ attempts: number }>(sql`
      insert into auth_rate_limits (key, attempts, window_start)
      values (${key}, 1, now())
      on conflict (key) do update set
        attempts = case when auth_rate_limits.window_start <= now() - make_interval(secs => ${windowSeconds})
                        then 1 else auth_rate_limits.attempts + 1 end,
        window_start = case when auth_rate_limits.window_start <= now() - make_interval(secs => ${windowSeconds})
                            then now() else auth_rate_limits.window_start end
      returning attempts
    `);
    return Number(result.rows[0]?.attempts ?? 1);
  },

  async clear(key: string, executor: DbExecutor = db): Promise<void> {
    await executor.delete(authRateLimits).where(sql`${authRateLimits.key} = ${key}`);
  },

  /** Keeps the table bounded: removes counters whose window ended more than `olderThanSeconds` ago. */
  async deleteStale(olderThanSeconds: number, executor: DbExecutor = db): Promise<void> {
    await executor.delete(authRateLimits).where(sql`${authRateLimits.windowStart} < now() - make_interval(secs => ${olderThanSeconds})`);
  },
};
