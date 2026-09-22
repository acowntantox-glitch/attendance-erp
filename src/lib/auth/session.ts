import { randomBytes, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { companyMemberships, sessions, type roleEnum } from "@/db/schema";
export { SESSION_COOKIE_NAME } from "./constants";

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const SESSION_RENEWAL_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 15; // renew when < 15 days remain

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
};

export type SessionCompanyContext = {
  companyId: string;
  role: (typeof roleEnum.enumValues)[number];
};

export type ValidatedSession = {
  sessionId: string;
  expiresAt: Date;
  user: SessionUser;
  company: SessionCompanyContext | null;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(
  userId: string,
  companyId: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const sessionId = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    companyId,
    expiresAt,
  });

  return { token, expiresAt };
}

export async function validateSessionToken(token: string): Promise<ValidatedSession | null> {
  const sessionId = hashToken(token);

  const row = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    with: { user: true },
  });

  if (!row) return null;

  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  if (row.user.status !== "active") {
    return null;
  }

  let expiresAt = row.expiresAt;
  if (expiresAt.getTime() - Date.now() < SESSION_RENEWAL_THRESHOLD_MS) {
    expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, sessionId));
  }

  let company: SessionCompanyContext | null = null;
  if (row.companyId) {
    const membership = await db.query.companyMemberships.findFirst({
      where: and(
        eq(companyMemberships.userId, row.userId),
        eq(companyMemberships.companyId, row.companyId),
        eq(companyMemberships.isActive, true),
      ),
    });
    if (membership) {
      company = { companyId: membership.companyId, role: membership.role };
    }
  }

  return {
    sessionId,
    expiresAt,
    user: { id: row.user.id, email: row.user.email, fullName: row.user.fullName },
    company,
  };
}

export async function invalidateSession(token: string): Promise<void> {
  const sessionId = hashToken(token);
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function invalidateAllSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
