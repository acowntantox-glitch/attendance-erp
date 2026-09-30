import { boolean, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { companies } from "./organization";

export const userStatusEnum = pgEnum("user_status", ["active", "inactive"]);

export const roleEnum = pgEnum("role", [
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "HR_ADMIN",
  "HR_MANAGER",
  "MANAGER",
  "EMPLOYEE",
]);

export const users = pgTable("users", {
  id: id(),
  email: text().notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  status: userStatusEnum().notNull().default("active"),
  // Set when an administrator resets the password (the temporary password is known to that admin);
  // cleared by the user's own password change. While true the account may only reach the
  // change-password flow (see lib/auth/request-context.ts).
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  ...timestamps,
});

/**
 * Roles are scoped per company membership, not global — see docs/architecture/security-architecture.md.
 * SUPER_ADMIN in Phase 1 is still expressed as a membership row (company-scoped); true
 * cross-company super-admin access is a documented future extension, not implemented yet.
 */
export const companyMemberships = pgTable(
  "company_memberships",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    role: roleEnum().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [unique("company_memberships_user_company_unique").on(table.userId, table.companyId)],
);

/**
 * `id` is the SHA-256 hash of the session token; the raw token is only ever held by the client
 * (httpOnly cookie). This mirrors the QR-token pattern in security-architecture.md so a DB read
 * never exposes a usable session credential.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Supports invalidateAllSessionsForUser() (logout-everywhere / forced revocation on role change).
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

/**
 * Fixed-window failure counters for login and password-change abuse protection — see
 * domains/auth/rate-limit.service.ts. One row per hashed key (`login-email:<sha256>`,
 * `login-ip:<sha256>`, `pw-change:<sha256>`), so it never stores an email, an IP or a password, and
 * its size is bounded by an opportunistic cleanup of rows whose window ended more than a day ago.
 * Not tenant data: a key is not tied to any company.
 */
export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    key: text().primaryKey(),
    attempts: integer().notNull().default(0),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("auth_rate_limits_window_start_idx").on(table.windowStart)],
);
