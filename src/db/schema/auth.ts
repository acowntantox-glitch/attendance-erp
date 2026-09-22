import { boolean, index, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
