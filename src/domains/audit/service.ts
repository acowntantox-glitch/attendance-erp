import type { RequestContext } from "@/lib/auth/request-context";
import { logger } from "@/lib/logger";
import { auditLogRepository } from "./repository";

const REDACTED_KEYS = new Set(["passwordHash", "password", "sessionToken", "biometricTemplate"]);

function redact(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, val]) => [
      key,
      REDACTED_KEYS.has(key) ? "[REDACTED]" : redact(val),
    ]),
  );
}

export type RecordAuditLogInput = {
  action: string;
  entityType: string;
  entityId?: string;
  oldData?: unknown;
  newData?: unknown;
  metadata?: Record<string, unknown>;
};

/**
 * Writes to the business audit trail (HR/compliance-facing), distinct from technical logs
 * written via `@/lib/logger`. Never throws — an audit-log failure must not block the business
 * operation it's describing, but it is logged loudly so it can be investigated.
 */
export async function recordAuditLog(ctx: RequestContext | null, input: RecordAuditLogInput): Promise<void> {
  try {
    await auditLogRepository.insert({
      companyId: ctx?.companyId ?? null,
      actorUserId: ctx?.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      oldData: redact(input.oldData) as object | undefined,
      newData: redact(input.newData) as object | undefined,
      metadata: { requestId: ctx?.requestId, ...input.metadata },
    });
  } catch (error) {
    logger.error({ err: error, action: input.action, entityType: input.entityType }, "Failed to write audit log");
  }
}
