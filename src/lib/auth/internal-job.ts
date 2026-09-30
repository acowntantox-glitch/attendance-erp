import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env";
import { AuthenticationError } from "@/lib/errors";

const BEARER_PREFIX = "Bearer ";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Whether an `Authorization` header carries ANY of the configured job secrets. Both sides are
 * hashed first so each comparison is constant-time regardless of length, every configured secret
 * is compared (no early exit that would reveal which one matched), and unset/empty secrets
 * authorize nothing — the endpoint is disabled until at least one secret is configured. Secrets
 * are never logged or echoed.
 */
export function isInternalJobAuthorized(authorizationHeader: string | null, ...secrets: (string | undefined)[]): boolean {
  if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) return false;
  const presented = authorizationHeader.slice(BEARER_PREFIX.length).trim();
  if (presented.length === 0) return false;

  const presentedDigest = digest(presented);
  let authorized = false;
  for (const secret of secrets) {
    if (!secret) continue;
    if (timingSafeEqual(presentedDigest, digest(secret))) authorized = true;
  }
  return authorized;
}

/** Route guard for machine-to-machine job endpoints. Deliberately independent of the user session
 *  mechanism: it authenticates the scheduler only, and grants no company or user identity. Accepts
 *  `INTERNAL_JOB_SECRET` (any external scheduler) or `CRON_SECRET` (what Vercel Cron sends). */
export function assertInternalJobRequest(request: Request): void {
  if (!isInternalJobAuthorized(request.headers.get("authorization"), env.INTERNAL_JOB_SECRET, env.CRON_SECRET)) {
    throw new AuthenticationError("Invalid or missing job credentials.");
  }
}
