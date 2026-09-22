# Attendance & Workforce ERP

Modular-monolith Next.js/TypeScript/PostgreSQL foundation. See [`docs/architecture/`](docs/architecture) for the full architecture and [`docs/decisions/`](docs/decisions) for ADRs.

## Prerequisites

- Node.js 20+
- pnpm (`corepack enable` or `npm i -g pnpm`)
- PostgreSQL 14+ (local install or `docker compose up postgres`)

## Setup

```bash
pnpm install
cp .env.example .env.local   # then fill in DATABASE_URL / SESSION_SECRET
pnpm db:generate              # generate SQL migrations from src/db/schema
pnpm db:migrate                # apply migrations
pnpm db:seed                   # development-only demo company + users
pnpm dev
```

Seeded users (see `scripts/seed.ts`) share the password `DevPassword123!`: `superadmin@acme.dev`, `admin@acme.dev`, `hradmin@acme.dev`, `hrmanager@acme.dev`, `manager@acme.dev`, `employee@acme.dev`.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the dev server |
| `pnpm build` / `pnpm start` | Production build / run |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` |
| `pnpm test` / `pnpm test:watch` | Vitest unit + integration tests |
| `pnpm test:e2e` | Playwright E2E (needs a running, seeded app) |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:studio` | Drizzle workflow |

## Testing without a database

Unit tests run without Postgres. Integration tests that need a real database (tenant isolation, repository, auth flow) detect connectivity and skip themselves if `DATABASE_URL` isn't reachable — see `src/tests/setup/db.ts`.

## Docker

```bash
SESSION_SECRET=$(openssl rand -base64 48) docker compose up --build
```

## Architecture rules that must not be violated

- All attendance capture methods converge into one Attendance Event pipeline (no method-specific tables/paths) — future phases.
- Tenant isolation is enforced server-side only (`RequestContext` + `assertCompanyAccess`), never by trusting a client-supplied `companyId`.
- Other domains may only import a domain's `service.ts`, never its `repository.ts`/`model.ts` internals.
