import { db } from "@/db/client";
import { auditLogs } from "@/db/schema";

export type AuditLogEntry = typeof auditLogs.$inferInsert;

export const auditLogRepository = {
  insert(entry: AuditLogEntry) {
    return db.insert(auditLogs).values(entry);
  },
};
