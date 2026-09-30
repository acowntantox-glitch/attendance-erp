/**
 * Company-scoped user administration (Batch 15). Every operation:
 *  - requires the existing `user.manage` permission (checked here, not just in the UI),
 *  - resolves the target ONLY through the caller's own company (`ctx.companyId` from the session),
 *    so another tenant's user is a 404, never a 403 that would confirm it exists,
 *  - refuses acting on oneself and on a higher-ranked role (`canManageUserRole`),
 *  - runs its state change and session revocation in one transaction under a row lock.
 *
 * `users` is global but memberships are per company, so a company can only ever affect ITS OWN
 * membership: deactivating flips that company's `is_active` (never the global `users.status`), and a
 * password — which is global — may be reset by a company only for an account that belongs to no other
 * company.
 */
import { db } from "@/db/client";
import type { RequestContext } from "@/lib/auth/request-context";
import { requirePermission } from "@/lib/auth/request-context";
import { canManageUserRole } from "@/lib/auth/rbac";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { invalidateAllSessionsForUser, invalidateSessionsForUserInCompany } from "@/lib/auth/session";
import { AuthorizationError, BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { recordAuditLog } from "@/domains/audit/service";
import { userManagementRepository, type CompanyUserRow, type MembershipTarget } from "./user-management.repository";

export type ManagedUser = Omit<CompanyUserRow, "membershipId"> & {
  isSelf: boolean;
  /** Whether the caller may activate/deactivate/reset this user — computed server-side for the UI;
   *  the mutating operations re-check it independently. */
  canManage: boolean;
};

export async function listCompanyUsers(ctx: RequestContext): Promise<ManagedUser[]> {
  requirePermission(ctx, "user.manage");
  const rows = await userManagementRepository.listForCompany(ctx.companyId);
  return rows.map(({ membershipId: _membershipId, ...user }) => {
    const isSelf = user.userId === ctx.userId;
    return { ...user, isSelf, canManage: !isSelf && canManageUserRole(ctx.role, user.role) };
  });
}

/** Shared by every mutating operation, inside its transaction. */
function assertMayManage(ctx: RequestContext, target: MembershipTarget | undefined, selfMessage: string): MembershipTarget {
  if (!target) throw new NotFoundError("User");
  if (target.userId === ctx.userId) throw new BusinessRuleError(selfMessage);
  if (!canManageUserRole(ctx.role, target.role)) {
    throw new AuthorizationError("You do not have permission to manage a user with this role.");
  }
  return target;
}

export type SetUserActiveResult = { userId: string; isActive: boolean; changed: boolean };

/**
 * Activates or deactivates the user's membership in the caller's company. Deactivation also revokes
 * that user's sessions FOR THIS COMPANY in the same transaction, so nothing already signed in keeps
 * working (and `validateSessionToken` independently rejects a session whose membership is inactive).
 * Historical data and audit rows are untouched. Repeating the current state is a no-op.
 */
export async function setUserActive(ctx: RequestContext, targetUserId: string, isActive: boolean): Promise<SetUserActiveResult> {
  requirePermission(ctx, "user.manage");

  const result = await db.transaction(async (tx) => {
    const target = assertMayManage(
      ctx,
      await userManagementRepository.findMembershipForUpdate(ctx.companyId, targetUserId, tx),
      "You cannot change the status of your own account.",
    );
    if (target.membershipActive === isActive) return { target, changed: false };

    await userManagementRepository.setMembershipActive(target.membershipId, isActive, tx);
    if (!isActive) await invalidateSessionsForUserInCompany(target.userId, ctx.companyId, tx);
    return { target, changed: true };
  });

  if (result.changed) {
    await recordAuditLog(ctx, {
      action: isActive ? "user.activated" : "user.deactivated",
      entityType: "user",
      entityId: result.target.userId,
      metadata: { targetRole: result.target.role, sessionsInvalidated: !isActive },
    });
  }
  return { userId: result.target.userId, isActive, changed: result.changed };
}

export type ResetPasswordResult = { userId: string; temporaryPassword: string };

/**
 * Sets a random one-time password for a member of the caller's company, flags the account so the
 * user must choose their own password at next sign-in, and revokes ALL of the user's sessions — all
 * in one transaction. The temporary password is returned to the calling administrator exactly once,
 * to be handed over out-of-band; it is never emailed, logged, audited or stored (only its Argon2id
 * hash is). Refused for an account that also belongs to another company: the password is global, so
 * one company must not be able to lock another company's user out.
 */
export async function resetUserPassword(ctx: RequestContext, targetUserId: string): Promise<ResetPasswordResult> {
  requirePermission(ctx, "user.manage");

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const target = await db.transaction(async (tx) => {
    const member = assertMayManage(
      ctx,
      await userManagementRepository.findMembershipForUpdate(ctx.companyId, targetUserId, tx),
      "Use Change Password to change your own password.",
    );
    if ((await userManagementRepository.countMembershipsInOtherCompanies(member.userId, ctx.companyId, tx)) > 0) {
      throw new ConflictError(
        "This account belongs to more than one company, so its password cannot be reset from here. Ask the user to change it themselves.",
      );
    }

    await userManagementRepository.setPassword(member.userId, passwordHash, true, tx);
    await invalidateAllSessionsForUser(member.userId, tx);
    return member;
  });

  await recordAuditLog(ctx, {
    action: "auth.password_reset",
    entityType: "user",
    entityId: target.userId,
    metadata: { targetRole: target.role, sessionsInvalidated: true, mustChangePassword: true },
  });
  return { userId: target.userId, temporaryPassword };
}
