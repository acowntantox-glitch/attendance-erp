/**
 * Self-service password change. Any authenticated, active user may change their OWN password; there
 * is no permission check beyond being signed in, and the target is always the caller (`ctx.userId`) —
 * never an id from the client.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { RequestContext } from "@/lib/auth/request-context";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "@/lib/auth/password";
import { invalidateAllSessionsForUser } from "@/lib/auth/session";
import { AuthenticationError, BusinessRuleError, ValidationError } from "@/lib/errors";
import { recordAuditLog } from "@/domains/audit/service";
import { assertNotRateLimited, clearFailures, passwordChangeRule, recordFailedAttempt } from "./rate-limit.service";

export type ChangePasswordInput = { currentPassword: string; newPassword: string };

/**
 * Verifies the current password, applies the central password policy, and — in ONE transaction that
 * holds a row lock on the user — replaces the hash, clears any forced-change flag, and revokes EVERY
 * session of the user (including the caller's own; they sign in again with the new password). The
 * lock serializes two concurrent changes, so neither can validate against a hash the other just
 * replaced, and no session survives a committed change.
 *
 * Errors are deliberately terse: a wrong current password is reported as such (the caller is
 * authenticated), guessing it is rate-limited, and nothing about the stored hash is ever returned.
 * Passwords and hashes are never logged or audited.
 */
export async function changeOwnPassword(ctx: RequestContext, input: ChangePasswordInput): Promise<void> {
  const rule = passwordChangeRule(ctx.userId);
  const counts = await assertNotRateLimited([rule]);

  const policy = validatePasswordPolicy(input.newPassword, { email: ctx.userEmail });
  if (!policy.ok) throw new ValidationError(policy.reason);

  const outcome = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, ctx.userId)).for("update");
    if (!user || user.status !== "active") return "invalid" as const;

    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) return "wrong-current" as const;
    if (await verifyPassword(user.passwordHash, input.newPassword)) return "same" as const;

    const passwordHash = await hashPassword(input.newPassword);
    await tx.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, user.id));
    await invalidateAllSessionsForUser(user.id, tx);
    return "changed" as const;
  });

  if (outcome === "invalid") throw new AuthenticationError();
  if (outcome === "wrong-current") {
    await recordFailedAttempt([rule], { action: "auth.password_change_rate_limited", context: "password-change" });
    throw new ValidationError("Current password is incorrect.");
  }
  if (outcome === "same") throw new BusinessRuleError("New password must be different from your current password.");

  await clearFailures(rule, counts);
  await recordAuditLog(ctx, {
    action: "auth.password_changed",
    entityType: "user",
    entityId: ctx.userId,
    metadata: { sessionsInvalidated: true },
  });
}
