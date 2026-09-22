# Production Readiness

## Infrastructure Summary
| Concern | Phase 0 recommendation | Upgrade trigger |
|---|---|---|
| Database | Single managed PostgreSQL instance (e.g., RDS/Cloud SQL/Supabase/Neon) | Read replica once reporting queries contend with write load |
| Background jobs | Postgres-backed job table + scheduled runner (cron / Vercel Cron / `node-cron` in a persistent process) | BullMQ + Redis once job volume/concurrency (e.g., many devices syncing in parallel, large report generation) exceeds what a simple polling table handles well |
| File/object storage | Not required initially (no raw biometric images stored, see security-architecture.md) | If a vendor requires image upload passthrough, use short-lived signed URLs to the vendor's own storage, not local storage |
| Deployment | Persistent Node process (Docker container on a VM/PaaS) — favored over pure serverless because device polling and scheduled recalculation benefit from a long-running process | Move latency-sensitive read paths to edge/serverless once the monolith is split, if ever needed |
| Monitoring | Structured JSON logs (`lib/logger`) shipped to a log aggregator (provider TBD); error tracking via Sentry (or equivalent) | Add metrics/dashboards (e.g., Prometheus/Grafana or a hosted APM) once there's real traffic to observe |
| CI/CD | Not yet configured — no `.github/workflows` exists in this empty repo | Set up on first implementation PR: lint + typecheck + unit + integration tests as required checks |

## Observability
- **Structured logging**: every log line includes `requestId`, `companyId` (when available), `userId` (when available), and `jobId` for background jobs — enables tracing a single attendance action across layers.
- **Error tracking**: unhandled exceptions and mapped domain errors (at ERROR severity) reported to an error tracker with the same correlation IDs.
- **Audit logging**: separate from technical logs — see security-architecture.md; queryable by Admin/HR, not just for debugging.
- **Sensitive data**: request/response bodies are never logged wholesale; logger explicitly whitelists fields to include, redacting passwords, session tokens, raw GPS-derived PII where not needed, and biometric payloads entirely.
- **Device sync status**: `attendance_import_batches.status` surfaced in an Admin dashboard, not just in logs.

## Performance
High-volume operations identified:
- Attendance event creation (potentially many employees checking in within the same minute window at shift start).
- Employee attendance history queries (date-range, must be indexed and paginated — see database-architecture.md).
- HR attendance register (whole-company, date-range — same indexing concern, plus needs query result pagination or streaming export for large companies).
- Device synchronization (batch inserts, should use bulk insert within a transaction, not row-by-row).
- Daily calculation job (nightly batch across all active employees — should be chunked/paginated, not one giant in-memory pass).

Recommendations:
- Composite indexes as listed in database-architecture.md.
- Pagination enforced server-side (max page size) on all list endpoints.
- Bulk/batched writes for device sync and nightly recalculation, wrapped in transactions sized to avoid long lock windows.
- Caching: not introduced initially — Postgres with proper indexes should handle expected scale (hundreds of employees per company, tens of companies) without a cache layer. Revisit only if a specific query is measured as a bottleneck (e.g., dashboard "today's attendance summary" under heavy concurrent HR access), not preemptively.

## Concurrency
See attendance-architecture.md — idempotency keys, DB unique constraints, and transactional row-level checks are the primary mechanism; no reliance on in-memory locks (incompatible with horizontal scaling).

## Risks
| Severity | Risk | Notes |
|---|---|---|
| CRITICAL | Tenant data leakage across companies | Mitigated by service-layer + schema-level company_id enforcement (security-architecture.md); requires disciplined code review until automated (lint rule / RLS) is added |
| CRITICAL | Duplicate/racy attendance events corrupting payroll-relevant data | Mitigated by idempotency keys + DB constraints + transactions (ADR-0009) |
| HIGH | Biometric data mishandling (legal/compliance exposure) | Mitigated by never storing raw biometric data locally; must be revisited if a specific vendor/jurisdiction requires local storage |
| HIGH | Incorrect overnight/timezone handling causing wrong late/overtime calculation | Mitigated by explicit timezone-aware calculation design (workforce domain) and dedicated unit tests |
| HIGH | Auth/RBAC library choice made hastily, causing rework | Flagged as an open decision requiring confirmation before Phase 1 |
| MEDIUM | Device vendor lock-in via adapter design gaps | Mitigated by `BiometricDeviceAdapter` interface, but real vendor SDKs may reveal interface gaps only during integration |
| MEDIUM | Background job infra under/over-provisioned | Mitigated by starting simple (DB-polling) and defining a clear upgrade trigger to BullMQ/Redis |
| LOW | UI/styling churn | Low business risk, easy to iterate |

## Implementation Roadmap (recommended order for Phase 1+)
1. Project scaffolding: Next.js + TS + Tailwind + Drizzle + PostgreSQL connection, env config validation, base folder structure from system-architecture.md.
2. Organization + Auth domains: companies, branches, departments, locations; session-based auth; RBAC primitives; RequestContext plumbing.
3. Employee domain: CRUD + assignment to org structure.
4. Workforce domain: schedules, shifts, holidays, policies (data model + admin UI), including overnight-shift and timezone handling.
5. Attendance core: event table, idempotency/concurrency mechanics, manual HR capture method first (simplest, no external verification dependency).
6. Calculation Engine: implemented and unit-tested against the edge cases in attendance-architecture.md, wired to manual events first.
7. Corrections workflow (HR approval loop) — proves out the "raw events immutable, derived records recalculable" model end-to-end.
8. GPS verification + GPS attendance capture method.
9. QR verification + QR attendance capture method.
10. Reporting domain: HR register, date-range reports, basic analytics — consuming daily records only.
11. Audit logging wired into all sensitive mutations identified in security-architecture.md.
12. Face verification (provider abstraction + one concrete provider integration).
13. Biometric device integration (one vendor adapter first).
14. Background job infra formalized (nightly recalculation, device polling) once the above justifies it.
15. Observability hardening (structured logging, error tracking, dashboards) and CI/CD setup.
16. Mobile-readiness pass: verify all attendance APIs are consumable by a React Native client without browser-specific assumptions; scaffold Expo app if greenlit.

Each step should ship with its own unit/integration tests per testing-strategy.md before moving to the next.
