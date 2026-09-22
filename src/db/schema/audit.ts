import { jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { companies } from "./organization";
import { users } from "./auth";

/**
 * Business audit trail (HR/admin/compliance-facing) — distinct from technical application logs.
 * See docs/architecture/security-architecture.md "Audit Logging".
 */
export const auditLogs = pgTable("audit_logs", {
  id: id(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text().notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  oldData: jsonb("old_data"),
  newData: jsonb("new_data"),
  metadata: jsonb(),
  createdAt: timestamps.createdAt,
});
