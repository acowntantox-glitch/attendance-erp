# Database Architecture

## Engine & ORM
PostgreSQL + Drizzle ORM. See ADR-0002. Migrations managed via `drizzle-kit`, checked into `src/db/migrations/`, never hand-edited after being applied to a shared environment.

## Schema Organization
Schema files grouped by domain under `src/db/schema/` (e.g., `organization.ts`, `employee.ts`, `workforce.ts`, `attendance.ts`, `verification.ts`, `devices.ts`, `audit.ts`), each exporting Drizzle table definitions. A root `src/db/schema/index.ts` re-exports everything for the Drizzle client.

## Conceptual Tables (design only — not created in this phase)

### Organization
- `companies` (id, name, timezone, settings jsonb, created_at, ...)
- `branches` (id, company_id FK, name, address, lat, lng, radius_meters, timezone override)
- `departments` (id, company_id FK, name)
- `locations` (id, company_id FK, branch_id FK, name, lat, lng, radius_meters) — supports multiple attendance-valid points per branch

### Employee
- `employees` (id, company_id FK, user_id FK nullable, employee_code, name, department_id FK, designation, branch_id FK, status, hired_at, ...)
- `employee_assignments` (id, employee_id FK, work_schedule_id FK, effective_from, effective_to) — time-bound so schedule history is preserved

### Workforce
- `work_schedules` (id, company_id FK, name, timezone)
- `work_schedule_days` (id, work_schedule_id FK, day_of_week, shift_id FK nullable, is_off_day)
- `shifts` (id, company_id FK, name, start_time, end_time, crosses_midnight boolean, break_rules jsonb)
- `holidays` (id, company_id FK, branch_id FK nullable, date, name)
- `attendance_policies` (id, company_id FK, grace_minutes, min_hours_full_day, min_hours_half_day, overtime_threshold_minutes, rounding_rules jsonb)

### Attendance
- `attendance_events` (id, company_id FK, employee_id FK, event_type, captured_at timestamptz, method, verification_result_id FK nullable, idempotency_key, source_metadata jsonb, created_at) — **append-only**, unique constraint on `(employee_id, idempotency_key)`
- `attendance_daily_records` (id, company_id FK, employee_id FK, date, gross_minutes, break_minutes, working_minutes, late_minutes, early_departure_minutes, overtime_minutes, status, calculated_at, calculation_version) — **derived, recalculable**, unique on `(employee_id, date)`
- `attendance_corrections` (id, company_id FK, employee_id FK, date, requested_by, reason, requested_change jsonb, status [PENDING/APPROVED/REJECTED], reviewed_by, reviewed_at)
- `attendance_audit_logs` — see Audit domain below (may live in a shared `audit_logs` table with an `entity_type` discriminator instead of a duplicate attendance-specific table; decision: use one shared `audit_logs` table, see database-architecture.md#audit-table)

### Verification
- `attendance_qr_tokens` (id, company_id FK, location_id FK, token_hash, expires_at, used_at nullable, created_by)
- `face_enrollments` (id, employee_id FK, provider, provider_reference_id, enrolled_at, status) — **no raw image/template stored locally**, only a reference ID to the vendor's storage (see security-architecture.md)
- `verification_logs` (id, company_id FK, employee_id FK, method, result, reason, captured_at, metadata jsonb)

### Devices
- `attendance_devices` (id, company_id FK, branch_id FK, vendor, serial_number, last_synced_at, status)
- `attendance_device_users` (id, device_id FK, device_user_id, employee_id FK) — mapping table, vendor's internal user ID → employee
- `attendance_import_batches` (id, device_id FK, started_at, finished_at, status, total_records, success_count, error_count)
- `attendance_import_errors` (id, import_batch_id FK, raw_record jsonb, error_message)

### Audit (shared)
- `audit_logs` (id, company_id FK, actor_user_id FK, action, entity_type, entity_id, old_data jsonb nullable, new_data jsonb nullable, metadata jsonb, created_at) — single table, indexed on `(company_id, entity_type, entity_id)` and `(company_id, created_at)`.

## Tenant Isolation at the Schema Level
Every table above (except pure lookup/reference tables, if any) carries `company_id` as a non-null FK. This is enforced at three layers, not just one:
1. **Schema**: `company_id NOT NULL REFERENCES companies(id)`, and composite foreign keys/unique constraints include `company_id` where relevant (e.g., `employee_code` unique per company, not globally) to make cross-tenant leakage structurally harder.
2. **Repository layer**: every Drizzle query in a domain's `repository.ts` must include a `company_id` filter sourced from the authenticated context — never from client input. This is a code-review/lint concern, not something Postgres enforces by itself (Postgres Row-Level Security is a future hardening option, noted in production-readiness.md, but is not the initial mechanism because it adds operational complexity the team isn't set up for yet).
3. **Service layer**: domain services accept a `RequestContext { companyId, userId, roles }` derived only from the authenticated session, and pass it down — API route handlers never accept `companyId` from the request body/query for write operations.

## Indexing Strategy (initial)
- `attendance_events`: index on `(company_id, employee_id, captured_at)` for history queries; unique on `(employee_id, idempotency_key)`.
- `attendance_daily_records`: unique on `(employee_id, date)`; index on `(company_id, date)` for HR register/date-range reports.
- `audit_logs`: index on `(company_id, created_at)` and `(entity_type, entity_id)`.
- `employees`: unique on `(company_id, employee_code)`.

## Migrations
- Drizzle-kit generates SQL migration files from schema diffs; migrations run explicitly (`drizzle-kit migrate`), never auto-applied on app boot in production.
- Every schema change ships with a migration file committed alongside the code change that needs it — no manual `db push` to shared environments.
