# System Architecture

## Status
Repository is empty (greenfield). No prior code, config, or dependencies exist. This document defines the target foundation.

## Environment (inspected)
- OS: Windows 11 (dev machine)
- Node.js: v24.15.0
- npm: 11.12.1, pnpm: 10.33.2 available (yarn/docker not installed locally)
- Git: not yet initialized in this directory

## Chosen Stack
| Concern | Choice | Rationale |
|---|---|---|
| Framework | Next.js (App Router) | Single deployable for web UI + API route handlers; strong TS support; SSR for HR dashboards |
| Language | TypeScript (strict) | Compile-time safety for a domain with many invariants (time math, tenant isolation) |
| Database | PostgreSQL | ACID transactions, row locking, exclusion/unique constraints needed for attendance concurrency |
| ORM | Drizzle ORM | Type-safe SQL, explicit migrations, no hidden magic — matches modular monolith need for auditable queries |
| Package manager | pnpm | Already available, fast, strict node_modules (catches phantom deps) |
| Auth | Custom session-based auth (Lucia-style) or Auth.js — decision deferred to Phase 1, see open question below | Needs company-scoped sessions + RBAC, not just social login |
| Background jobs | Deferred until volume justifies it (see `production-readiness.md`) — start with Postgres-backed job table + cron via `node-cron`/Vercel Cron; upgrade to BullMQ+Redis when device sync/report volume requires it | Avoid premature infra |
| Validation | Zod | Pairs naturally with Drizzle + TS inference; used at API boundary and form boundary |
| Testing | Vitest (unit/integration) + Playwright (E2E) | Fast TS-native unit runner; Playwright for real browser flows (GPS/camera mocking) |
| Styling/UI | Tailwind CSS + shadcn/ui | Fast to build accessible HR/admin UIs without heavy design system overhead |
| Deployment | Node-based host (Docker container) or Vercel — decision deferred (biometric device sync and long-running jobs favor a persistent Node process over serverless) | See production-readiness.md |

## Why a Modular Monolith
- Single team, single deployable initially — a microservice split has no payoff yet and adds operational risk.
- Attendance domains are highly coupled (Employee → Workforce → Attendance → Calculation → Reporting) and share transactions; splitting them prematurely would force distributed transactions for what are fundamentally local invariants (e.g., "no duplicate check-in").
- Modular monolith preserves a clean seam (domain folders with explicit public interfaces) so specific domains (e.g., Device Sync, Reporting) can be extracted into services later if load requires it.
- See ADR-0001.

## Target Repository Structure
```
attendance-erp/
├── src/
│   ├── app/                    # Next.js App Router: pages + API route handlers only (thin)
│   │   ├── (dashboard)/        # Authenticated web UI routes
│   │   ├── api/                # Route handlers, grouped by domain (see api-architecture.md)
│   │   └── login/
│   ├── domains/                # Business logic, one folder per bounded context
│   │   ├── organization/
│   │   ├── employee/
│   │   ├── workforce/
│   │   ├── attendance/
│   │   ├── verification/
│   │   ├── devices/
│   │   ├── reporting/
│   │   ├── audit/
│   │   └── auth/
│   │       └── <domain>/
│   │           ├── service.ts       # public API of the domain (only entry point other domains call)
│   │           ├── repository.ts    # data access (Drizzle queries) — private to domain
│   │           ├── model.ts         # domain types/entities
│   │           ├── errors.ts        # domain-specific error classes
│   │           └── __tests__/
│   ├── db/
│   │   ├── schema/              # Drizzle schema files, grouped by domain
│   │   ├── migrations/
│   │   └── client.ts
│   ├── lib/                     # Cross-cutting technical utilities (not business logic)
│   │   ├── errors/               # Shared error taxonomy + API error mapper
│   │   ├── logger/
│   │   ├── auth/                 # session/RBAC primitives shared by domains
│   │   ├── tenancy/               # company-scoping helpers (see security-architecture.md)
│   │   └── time/                  # timezone-safe date utilities
│   ├── jobs/                     # Background job definitions + scheduler wiring
│   ├── config/                   # Environment/config loading (validated with Zod)
│   ├── validations/              # Zod schemas for API/input boundaries, mirrors domains/
│   ├── types/                    # Shared cross-domain types (e.g., API envelope types)
│   ├── components/               # Shared UI components (dumb/presentational)
│   └── tests/                    # Test setup, fixtures, integration/E2E helpers
├── drizzle.config.ts
├── docs/
│   ├── architecture/
│   └── decisions/
├── .env.example
├── next.config.ts
├── tsconfig.json
└── package.json
```

### Domain internal boundary rule
Other domains and the `app/api` layer may only import a domain's `service.ts`. Direct import of another domain's `repository.ts` or `model.ts` internals is disallowed — enforced later via lint rule (e.g., `eslint-plugin-boundaries`) once code exists. This is what makes future extraction into microservices low-risk.

## Open Decisions Requiring User Input Before Phase 1
1. **Auth library**: build minimal custom session auth vs. Auth.js vs. Lucia. Recommendation: custom lightweight session (httpOnly cookie + DB session table) for full control over company-scoping and RBAC — Auth.js adds abstraction that fights multi-tenant RBAC. Needs confirmation.
2. **Deployment target**: Vercel (serverless) vs. self-hosted Docker/VM (persistent process). Biometric device polling and background jobs favor a persistent process. Needs confirmation before choosing job infra.
3. **Face verification vendor**: none selected yet; architecture uses a provider interface (see verification-architecture.md) so this can be deferred safely.
4. Package manager confirmation: pnpm assumed (available locally) — confirm before scaffolding.
