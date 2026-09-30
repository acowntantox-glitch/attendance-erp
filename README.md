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
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:studio` | Drizzle workflow (`migrate` and `seed` refuse non-local databases — see Environment safety) |

## Environment safety (development, tests, seed, migrations)

Anything that can change data outside the running app refuses to touch a non-local database unless you explicitly confirm it. The check (`src/lib/db-safety.ts`) looks at the **parsed hostname** of `DATABASE_URL` — never `NODE_ENV` alone, since a developer's `.env.local` can point at production with `NODE_ENV=development` — and fails closed. Local hosts are `localhost`, `127.0.0.1`, `::1` and the compose service `postgres`. Errors name the host only, never the URL or credentials.

| Command | Local DB | Remote DB |
|---|---|---|
| `pnpm test` | runs | **refused**, unless `TEST_DATABASE_ALLOWED_HOST` is set to that exact host (a dedicated test database only) |
| `pnpm db:seed` | runs | **refused**, unless `SEED_ALLOW_REMOTE_HOST` is set to that exact host; always refused when `NODE_ENV=production` |
| `pnpm db:migrate` | runs | **refused**, unless `MIGRATE_ALLOW_REMOTE_HOST` is set to that exact host (this is how you deliberately migrate production) |

To migrate the production database on purpose:

```powershell
$env:MIGRATE_ALLOW_REMOTE_HOST = "<the exact database hostname>"; pnpm db:migrate
```

**Tests use their own database.** The test setup (`src/tests/setup/env.ts`) does **not** read `.env.local`. It reads, in order of precedence: variables already in the environment (CI sets `DATABASE_URL` to its Postgres service), then `.env.test.local` (git-ignored — put your real *local* test database URL here), then the committed placeholder `.env.test`. Create a separate database, e.g. `attendance_erp_test`, and run migrations against it:

```bash
# .env.test.local (never committed)
DATABASE_URL="postgresql://<user>:<password>@localhost:5432/attendance_erp_test"
```

```powershell
$env:DATABASE_URL = "postgresql://<user>:<password>@localhost:5432/attendance_erp_test"; pnpm db:migrate
```

Unit tests need no database. DB-backed suites detect an unreachable test database and skip themselves; a *production-like* database makes the run fail immediately with `Refusing to run integration tests against a production database`, before any fixture runs. CI provisions its own Postgres service and never uses `.env.local`.

## Docker

```bash
SESSION_SECRET=$(openssl rand -base64 48) docker compose up --build
```

## Scheduled attendance processing

`/api/internal/jobs/attendance-daily` (GET or POST) materializes **missing** daily attendance records (ABSENT, HOLIDAY, WEEKLY_OFF, NO_SCHEDULE, INCOMPLETE, ...) for work dates that are safely over. It reuses the normal attendance calculation; it never recalculates or modifies an existing record.

**Scheduler on Vercel.** `vercel.json` registers a Vercel Cron job for this path, daily at `01:00 UTC` (`0 1 * * *`; 05:00 in Dubai, after the previous day plus the 3 h lag has ended). Vercel Cron calls it with `GET` and sends `Authorization: Bearer $CRON_SECRET`, so to activate it set the project environment variable **`CRON_SECRET`** (>= 16 random characters) in Vercel and redeploy. Cron is not active until that variable exists. Notes, from Vercel's documentation:
- On the **Hobby** plan cron can run at most once per day (a more frequent expression fails the deployment) and fires at any point within the scheduled hour. On **Pro** you can change the schedule to hourly (`0 * * * *`) so a partial run resumes sooner — the job is idempotent, so extra runs are harmless.
- Delivery is best effort: a run can be missed or repeated, and Vercel does not retry. That is safe here — the lookback window catches up missed runs and the per-company/date lock plus idempotency absorb duplicates.
- Other schedulers work too: `POST` (or `GET`) with `Authorization: Bearer $INTERNAL_JOB_SECRET`.

```bash
curl -fsS -X POST "$APP_URL/api/internal/jobs/attendance-daily" -H "Authorization: Bearer $INTERNAL_JOB_SECRET"
```

| Variable | Default | Purpose |
|---|---|---|
| `CRON_SECRET` | none | Secret Vercel Cron sends automatically (>= 16 chars). Accepted by the endpoint. |
| `INTERNAL_JOB_SECRET` | none | Secret for any other scheduler / manual calls (>= 32 chars). Accepted by the endpoint. `openssl rand -base64 48` |
| `ATTENDANCE_PROCESSING_LAG_MINUTES` | `180` | How long after a work date has ended before it is processed. |
| `ATTENDANCE_PROCESSING_LOOKBACK_DAYS` | `7` | How many of the most recent eligible dates each run examines, so missed invocations catch up. There is no unbounded backfill. |

**With neither secret set, the endpoint rejects every request.**

- **Authentication:** the bearer token is compared in constant time against every configured secret and is never logged or returned. The request body, query string and other headers are ignored: companies, dates and the time budget are decided server-side, so a caller cannot choose a tenant. Independent of user sessions.
- **Execution limit:** the route sets `maxDuration = 60` seconds (allowed on every Vercel plan) and gives the job a 45 s budget. The job checks the budget **between employees** and stops before starting more work; it never gets killed mid-employee. A run stopped this way is recorded as `Failed` with the message `Stopped early: time budget reached with N employee(s) not yet processed; the next invocation resumes.` (there is no separate "partial" status), the response reports `stoppedEarly: true`, and the next invocation continues with only the employees still missing. No queue or worker is needed. A very large company therefore catches up over several invocations; with a daily schedule that can take several days, so use an hourly schedule on Pro for big tenants.
- **When a date is processed:** a work date is due once it has ended in the latest-ending timezone the company operates in (company, active branches, active schedules) **and** after the latest end of any active shift/schedule that starts that day (so overnight shifts finish first), plus the lag. See `src/domains/attendance/processing/due-dates.ts`. It is company-wide and conservative: it can only delay, never advance.
- **Idempotency:** employees who already have a record for the date are skipped untouched; a second run creates nothing. Closed attendance periods are skipped. Archived and not-yet-joined employees are excluded, and only employees whose employment status was `ACTIVE` at the **end of that work date** are processed (see the limitation below). Check-outs are never fabricated and open sessions are never closed.
- **Concurrency:** a PostgreSQL transaction-level advisory lock per company/date plus the `(employee, work date)` unique index. Safe with several instances, overlapping invocations, and a pooled connection string.
- **Run history:** a row per run that had work to do in `attendance_processing_runs`, shown on the attendance dashboard ("Recent Processing Runs") and at `GET /api/attendance/process/runs` (requires `attendance.process.view`). Each run also writes one `attendance.process.scheduled` audit entry with no user (system actor).
- **Troubleshooting:** a 401 means the secret is missing/wrong/unset on the server (check `CRON_SECRET` in Vercel). A run with employee failures still completes; the failed employees appear in the run's `failed` count and message and are retried on the next invocation. A run stuck in `Running` after a crash or platform timeout is marked `Failed` ("Abandoned") automatically by the next run. Nothing is created for a date until it is due; if nothing appears, check Vercel's Cron Jobs page and runtime logs for the path. Vercel does not follow redirects, so the endpoint must be reached at its exact path.
- **Known limitation (employee status history):** the status at the end of a work date is reconstructed from `employee_history` using the time each change was *recorded*. The system never captures the date a change *took effect* (`employees.date_of_exit` and `employee_history.effective_date` are unused), so a change entered late (e.g. a resignation recorded days after the last working day) is treated as effective when entered. Capturing effective dates needs an employee-domain change and is deferred; HR can correct individual days through the existing manual processing and corrections.

## Architecture rules that must not be violated

- All attendance capture methods converge into one Attendance Event pipeline (no method-specific tables/paths) — future phases.
- Tenant isolation is enforced server-side only (`RequestContext` + `assertCompanyAccess`), never by trusting a client-supplied `companyId`.
- Other domains may only import a domain's `service.ts`, never its `repository.ts`/`model.ts` internals.

git add .
git commit -m "Update project"
git push
