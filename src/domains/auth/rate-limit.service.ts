/**
 * Lightweight, database-backed brute-force protection for login and password-change attempts.
 *
 * DESIGN (and its honest limits)
 *  - Fixed window per key, counted in Postgres: 15 minutes; a block lifts by itself when the window
 *    ends, so no account is ever locked permanently.
 *  - Limits: 5 failures per EMAIL per window (guessing one account), 20 per client IP per window
 *    (spraying many emails from one machine), 5 per USER for password-change attempts (a stolen
 *    session guessing the current password).
 *  - The email key is derived from the ATTEMPTED email whether or not such an account exists, and the
 *    "too many attempts" answer is identical either way, so the limiter does not reveal which emails
 *    are registered. Keys are SHA-256 hashes: no email, IP or password is stored.
 *  - Changing headers, casing, whitespace or the optional `companyId` does not evade the email
 *    limit: the key is the normalized email alone. Only the IP limit depends on the client IP.
 *  - Trade-off: an attacker who knows a victim's email can keep that ONE account throttled (denial of
 *    service against one login for at most 15 minutes at a time). That is the standard price of a
 *    per-account limit and is preferred over allowing unlimited guessing.
 *  - Load: one indexed read per attempt; writes only on failures (one upsert per key, one cleanup
 *    delete) and one delete after a successful login that had prior failures.
 *  - This is not a WAF or bot defense: distributed guessing across many IPs AND many accounts is out
 *    of scope, as are CAPTCHA and MFA (later batches).
 */
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { recordAuditLog } from "@/domains/audit/service";
import { TooManyRequestsError } from "@/lib/errors";
import { rateLimitRepository } from "./rate-limit.repository";

export const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
export const LOGIN_MAX_FAILURES_PER_EMAIL = 5;
export const LOGIN_MAX_FAILURES_PER_IP = 20;
export const PASSWORD_CHANGE_MAX_FAILURES_PER_USER = 5;
/** Counters whose window ended more than a day ago are deleted (opportunistically, on failures). */
const STALE_AFTER_SECONDS = 24 * 60 * 60;

export type RateLimitRule = { key: string; max: number };

function hashKey(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex")}`;
}

export function loginEmailRule(email: string): RateLimitRule {
  return { key: hashKey("login-email", email.trim().toLowerCase()), max: LOGIN_MAX_FAILURES_PER_EMAIL };
}

export function loginIpRule(ip: string): RateLimitRule {
  return { key: hashKey("login-ip", ip), max: LOGIN_MAX_FAILURES_PER_IP };
}

export function passwordChangeRule(userId: string): RateLimitRule {
  return { key: hashKey("pw-change", userId), max: PASSWORD_CHANGE_MAX_FAILURES_PER_USER };
}

/**
 * The client IP, or null when it cannot be determined reliably. On Vercel `x-forwarded-for` is set by
 * the platform (a client-supplied value is replaced), so its first hop is the caller. When there is no
 * usable IP (local dev) the IP rule is simply skipped — a shared "unknown" bucket would let one
 * attacker lock everyone out.
 */
export function getClientIp(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded && isIP(forwarded)) return forwarded;
  const real = headers.get("x-real-ip")?.trim();
  if (real && isIP(real)) return real;
  return null;
}

/** Throws `TooManyRequestsError` if ANY rule is already at its limit. Returns the in-window counts
 *  so the caller can tell (without another query) whether a successful attempt has failures to clear. */
export async function assertNotRateLimited(rules: RateLimitRule[]): Promise<Map<string, number>> {
  const counts = await rateLimitRepository.findActive(
    rules.map((rule) => rule.key),
    RATE_LIMIT_WINDOW_SECONDS,
  );
  if (rules.some((rule) => (counts.get(rule.key) ?? 0) >= rule.max)) {
    throw new TooManyRequestsError();
  }
  return counts;
}

/** Records a failed attempt against every rule. Writes one audit event only when a rule first
 *  reaches its limit (not on every blocked request), so an attacker cannot flood the audit log. */
export async function recordFailedAttempt(rules: RateLimitRule[], event: { action: string; context: string }): Promise<void> {
  const reached: string[] = [];
  for (const rule of rules) {
    const attempts = await rateLimitRepository.recordFailure(rule.key, RATE_LIMIT_WINDOW_SECONDS);
    if (attempts === rule.max) reached.push(rule.key.split(":")[0]!);
  }
  await rateLimitRepository.deleteStale(STALE_AFTER_SECONDS);

  if (reached.length > 0) {
    // No email / IP / user id in the record — only which limit was hit and where.
    await recordAuditLog(null, {
      action: event.action,
      entityType: "auth_rate_limit",
      metadata: { limits: reached, context: event.context, windowSeconds: RATE_LIMIT_WINDOW_SECONDS },
    });
  }
}

/** Relaxes a limit after a successful authentication (only if it had recorded failures). */
export async function clearFailures(rule: RateLimitRule, counts: Map<string, number>): Promise<void> {
  if ((counts.get(rule.key) ?? 0) > 0) await rateLimitRepository.clear(rule.key);
}
