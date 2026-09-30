import { createSession, invalidateSession, type SessionCompanyContext } from "@/lib/auth/session";
import { verifyPasswordConstantTime } from "@/lib/auth/password";
import { recordAuditLog } from "@/domains/audit/service";
import { companyMembershipRepository, userRepository } from "./repository";
import { AmbiguousCompanyContextError, InvalidCredentialsError, NoCompanyContextError } from "./errors";
import { toPublicUser, type PublicUser } from "./model";
import { assertNotRateLimited, clearFailures, loginEmailRule, loginIpRule, recordFailedAttempt } from "./rate-limit.service";

export type LoginResult = {
  token: string;
  expiresAt: Date;
  user: PublicUser;
  company: SessionCompanyContext;
};

/**
 * `clientIp` is optional (null/undefined when it cannot be determined reliably); it only adds the
 * per-IP limit. Order matters: the limit is checked BEFORE any password work, so a blocked client
 * costs one indexed read and no Argon2 CPU.
 */
export async function login(email: string, password: string, companyId?: string, clientIp?: string | null): Promise<LoginResult> {
  const emailRule = loginEmailRule(email);
  const rules = [emailRule, ...(clientIp ? [loginIpRule(clientIp)] : [])];
  const counts = await assertNotRateLimited(rules);

  const user = await userRepository.findByEmail(email);
  const usable = user !== undefined && user.status === "active";

  // Unknown and disabled accounts run the same Argon2 verification as a wrong password, and all
  // three produce the identical error, so neither the message nor the timing tells them apart.
  const passwordValid = await verifyPasswordConstantTime(usable ? user.passwordHash : null, password);
  if (!usable || !passwordValid) {
    await recordFailedAttempt(rules, { action: "auth.login_rate_limited", context: "login" });
    throw new InvalidCredentialsError();
  }

  const memberships = await companyMembershipRepository.listActiveForUser(user.id);
  if (memberships.length === 0) {
    throw new NoCompanyContextError();
  }

  let membership = memberships[0]!;
  if (companyId) {
    const match = memberships.find((m) => m.companyId === companyId);
    if (!match) throw new InvalidCredentialsError();
    membership = match;
  } else if (memberships.length > 1) {
    throw new AmbiguousCompanyContextError();
  }

  const { token, expiresAt } = await createSession(user.id, membership.companyId);

  // Race guard. The password was verified against a hash read a moment ago; if an administrator
  // reset it (or the user changed it, or the account was disabled) in between, the reset already
  // deleted every session that existed at the time — but not this one, which did not exist yet.
  // Re-reading AFTER the session row is committed closes the gap either way: if the change committed
  // first the hash differs and we discard this session; if it commits later it deletes this session.
  const current = await userRepository.findById(user.id);
  if (!current || current.status !== "active" || current.passwordHash !== user.passwordHash) {
    await invalidateSession(token);
    throw new InvalidCredentialsError();
  }

  // A correct login relaxes the per-account limit (the per-IP counter is left to expire on its own).
  await clearFailures(emailRule, counts);

  await recordAuditLog(
    { requestId: crypto.randomUUID(), userId: user.id, userEmail: user.email, companyId: membership.companyId, role: membership.role, employeeId: null },
    { action: "auth.login", entityType: "user", entityId: user.id },
  );

  return {
    token,
    expiresAt,
    user: toPublicUser(user),
    company: { companyId: membership.companyId, role: membership.role },
  };
}

export async function logout(token: string): Promise<void> {
  await invalidateSession(token);
}
