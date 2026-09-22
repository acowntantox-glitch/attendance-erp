# ADR-0008: Multi-Company Data Isolation

## Status
Accepted

## Context
The system must support multiple companies safely, even though it launches focused on one. Tenant data leakage (one company seeing another's employees/attendance) is a CRITICAL-severity risk. Relying on frontend filtering alone is unacceptable.

## Decision
Use a shared-database, `company_id`-column-per-table isolation model, enforced at three layers: (1) schema — `company_id NOT NULL` FK on every tenant-scoped table, with company-scoped uniqueness constraints where relevant; (2) repository — every query filters by `company_id` sourced from server-side `RequestContext`; (3) service — domain services only accept `RequestContext` derived from the authenticated session, never a client-supplied `companyId` for authorization-relevant decisions.

## Consequences
- Positive: simple to implement and reason about at current scale; no per-tenant infrastructure overhead.
- Positive: supports a clear future upgrade path to Postgres Row-Level Security or schema-per-tenant if stronger isolation guarantees are required later (e.g., regulatory), without changing the application-level `RequestContext` pattern.
- Negative: isolation correctness currently depends on consistent developer discipline (every repository query must remember the filter) until enforced by tooling (lint rule or RLS) — flagged as a HIGH risk in production-readiness.md until that tooling exists.
