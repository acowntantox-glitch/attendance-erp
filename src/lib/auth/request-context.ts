import { cookies, headers } from "next/headers";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";
// A per-request lookup, not cached on the session row — acceptable at current scale; if this
// becomes a hot path, the next step is storing employeeId on the session at login/link time
// instead of resolving it here on every request.
import { employeeRepository } from "@/domains/employee/repository";
import { SESSION_COOKIE_NAME, validateSessionToken } from "./session";
import { can, type Permission, type Role } from "./rbac";

export type RequestContext = {
  requestId: string;
  userId: string;
  userEmail: string;
  companyId: string;
  role: Role;
  employeeId: string | null;
};

/**
 * Resolves the authenticated request context from the session cookie only. `companyId` and
 * `role` NEVER come from client-supplied headers, query params, or body — see
 * docs/architecture/security-architecture.md "Tenant Isolation". Throws AuthenticationError if
 * there is no valid session or no active company context.
 */
export async function getRequestContext(): Promise<RequestContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    throw new AuthenticationError();
  }

  const session = await validateSessionToken(token);
  if (!session) {
    throw new AuthenticationError("Your session has expired. Please sign in again.");
  }

  if (!session.company) {
    throw new AuthenticationError("No active company context for this session.");
  }

  const headerStore = await headers();
  const requestId = headerStore.get("x-request-id") ?? crypto.randomUUID();

  const employee = await employeeRepository.findByUserId(session.company.companyId, session.user.id);

  return {
    requestId,
    userId: session.user.id,
    userEmail: session.user.email,
    companyId: session.company.companyId,
    role: session.company.role,
    employeeId: employee?.id ?? null,
  };
}

export function requirePermission(ctx: RequestContext, permission: Permission): void {
  if (!can(ctx.role, permission)) {
    throw new AuthorizationError(`Role ${ctx.role} does not have permission '${permission}'.`);
  }
}

/**
 * Enforces tenant isolation: the resource's companyId must match the caller's own companyId.
 * Call this in every service method that loads a resource by id, before returning or mutating it.
 */
export function assertCompanyAccess(ctx: RequestContext, resourceCompanyId: string): void {
  if (ctx.companyId !== resourceCompanyId) {
    throw new AuthorizationError("This resource does not belong to your company.");
  }
}
