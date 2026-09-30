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

## Scheduled attendance processing

`POST /api/internal/jobs/attendance-daily` materializes **missing** daily attendance records (ABSENT, HOLIDAY, WEEKLY_OFF, NO_SCHEDULE, INCOMPLETE, ...) for work dates that are safely over. It reuses the normal attendance calculation; it never recalculates or modifies an existing record.

**The app does not schedule itself and no scheduler is provisioned by this repository** (`docker-compose.yml` runs only the app and Postgres). You must call the endpoint from something you operate — host cron, a cloud scheduler, or any HTTP cron service that can reach the deployment — about hourly:

```bash
curl -fsS -X POST "$APP_URL/api/internal/jobs/attendance-daily"   -H "Authorization: Bearer $INTERNAL_JOB_SECRET"
```

| Variable | Default | Purpose |
|---|---|---|
| `INTERNAL_JOB_SECRET` | none | Shared secret (>= 32 chars) sent as a bearer token. Server-side only. **Unset = the endpoint rejects every request.** Generate with `openssl rand -base64 48`. |
| `ATTENDANCE_PROCESSING_LAG_MINUTES` | `180` | How long after a work date has ended before it is processed. |
| `ATTENDANCE_PROCESSING_LOOKBACK_DAYS` | `7` | How many of the most recent eligible dates each run examines, so a few missed invocations catch up. There is no unbounded backfill. |

- **Authentication:** the bearer secret is compared in constant time and is never logged or returned. The request body and query string are ignored: the companies, dates and lag are decided server-side, so a caller cannot choose a tenant.
- **When a date is processed:** a work date is due once it has ended in the latest-ending timezone the company operates in (company, active branches, active schedules) **and** after the latest end of any active shift/schedule that starts that day (so overnight shifts finish first), plus the lag. See `src/domains/attendance/processing/due-dates.ts`. It is company-wide and conservative: it can only delay, never advance.
- **Idempotency:** employees who already have a record for the date are skipped untouched; a second run creates nothing. Closed attendance periods are skipped. Archived and not-yet-joined employees are excluded, and only employees whose employment status was `ACTIVE` at the **end of that work date** are processed (see the limitation below). Check-outs are never fabricated and open sessions are never closed.
- **Concurrency:** a PostgreSQL transaction-level advisory lock per company/date plus the `(employee, work date)` unique index. Safe with several instances, and with a pooled connection string.
- **Run history:** a row per run that had work to do in `attendance_processing_runs`, shown on the attendance dashboard ("Recent Processing Runs") and at `GET /api/attendance/process/runs` (requires `attendance.process.view`). Each run also writes one `attendance.process.scheduled` audit entry with no user (system actor).
- **Troubleshooting:** a 401 means the secret is missing/wrong/unset on the server. A run with failures still completes; the failed employees appear in the run's `failed` count and message and are retried on the next invocation. A run stuck in `Running` after a crash is marked `Failed` ("Abandoned") automatically by the next run. Nothing is created for a date until it is due; if nothing appears, check the scheduler is actually calling the endpoint.
- **Known limitation (employee status history):** the status at the end of a work date is reconstructed from `employee_history` using the time each change was *recorded*. The system never captures the date a change *took effect* (`employees.date_of_exit` and `employee_history.effective_date` are unused), so a change entered late (e.g. a resignation recorded days after the last working day) is treated as effective when entered. Capturing effective dates needs an employee-domain change and is deferred; HR can correct individual days through the existing manual processing and corrections.

## Architecture rules that must not be violated

- All attendance capture methods converge into one Attendance Event pipeline (no method-specific tables/paths) — future phases.
- Tenant isolation is enforced server-side only (`RequestContext` + `assertCompanyAccess`), never by trusting a client-supplied `companyId`.
- Other domains may only import a domain's `service.ts`, never its `repository.ts`/`model.ts` internals.

git add .
git commit -m "Update project"
git push
