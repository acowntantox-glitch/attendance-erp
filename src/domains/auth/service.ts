import { createSession, invalidateSession, type SessionCompanyContext } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { recordAuditLog } from "@/domains/audit/service";
import { companyMembershipRepository, userRepository } from "./repository";
import { AmbiguousCompanyContextError, InvalidCredentialsError, NoCompanyContextError } from "./errors";
import { toPublicUser, type PublicUser } from "./model";

export type LoginResult = {
  token: string;
  expiresAt: Date;
  user: PublicUser;
  company: SessionCompanyContext;
};

export async function login(email: string, password: string, companyId?: string): Promise<LoginResult> {
  const user = await userRepository.findByEmail(email);
  if (!user || user.status !== "active") {
    throw new InvalidCredentialsError();
  }

  const passwordValid = await verifyPassword(user.passwordHash, password);
  if (!passwordValid) {
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
