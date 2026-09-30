import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env";
import { AuthenticationError } from "@/lib/errors";

const BEARER_PREFIX = "Bearer ";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Whether an `Authorization` header carries the configured internal-job secret. Both sides are
 * hashed first so the comparison is constant-time regardless of length, and an unset/empty secret
 * authorizes nothing (the endpoint is disabled until `INTERNAL_JOB_SECRET` is configured). The
 * secret is never logged or echoed.
 */
export function isInternalJobAuthorized(authorizationHeader: string | null, secret: string | undefined): boolean {
  if (!secret || !authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) return false;
  const presented = authorizationHeader.slice(BEARER_PREFIX.length).trim();
  if (presented.length === 0) return false;
  return timingSafeEqual(digest(presented), digest(secret));
}

/** Route guard for machine-to-machine job endpoints. Deliberately independent of the user session
 *  mechanism: it authenticates the scheduler only, and grants no company or user identity. */
export function assertInternalJobRequest(request: Request): void {
  if (!isInternalJobAuthorized(request.headers.get("authorization"), env.INTERNAL_JOB_SECRET)) {
    throw new AuthenticationError("Invalid or missing job credentials.");
  }
}
