# Security Architecture

## Authentication
Server-side session (httpOnly, secure, SameSite=Lax/Strict cookie) backed by a `sessions` table. Password hashing via `argon2` (preferred over bcrypt for new systems). Decision on library (custom vs. Auth.js/Lucia) is open — see system-architecture.md open questions.

## Authorization (RBAC)
Roles are scoped **per company membership**, not global:
```
user
 └── company_memberships (user_id, company_id, role)
```
Roles (initial set): `SUPER_ADMIN` (cross-company, internal use only), `COMPANY_ADMIN`, `HR`, `MANAGER`, `EMPLOYEE`. Permission checks happen in the service layer via a small policy function per action (e.g., `canApproveCorrection(ctx, correction)`), not scattered `if (role === ...)` checks in route handlers. Route handlers only authenticate + call the service; the service enforces authorization so the rule is checked identically regardless of caller (web, future mobile, background job).

## Tenant Isolation (Multi-Company)
- Every authenticated request resolves a `RequestContext { userId, companyId, role }`. `companyId` comes from the session/membership, never from client-supplied headers, body, or query params.
- All repository queries are company-scoped by construction (see database-architecture.md).
- Cross-company access (e.g., a future "HR consultant managing multiple companies" use case) is handled by requiring an explicit company-switch action that re-establishes `RequestContext`, not by allowing a single request to touch multiple companies.
- Future SaaS migration: current design (shared DB, `company_id` column, app-enforced isolation) scales to hundreds of tenants. If isolation guarantees need to be stronger (e.g., regulatory requirement for physical separation), Postgres schema-per-tenant or Row-Level Security is the next step — not needed at current scale, called out in production-readiness.md as a future hardening item.

## Frontend Trust Boundary
The application must not trust security-sensitive flags sent from the frontend. Concretely:
- GPS coordinates are input to a server-side distance calculation, but the *result* (inside/outside radius) is always recomputed server-side — a client cannot send `verified: true`.
- Face verification result comes from a server-to-provider call; the client never asserts a match score or pass/fail itself.
- QR "check-in allowed" is determined by server-side token validation (expiry, hash, single-use), not by the client believing it scanned a valid code.
- `companyId`, `employeeId` (for the acting user), and `role` are always derived server-side from the session — never accepted as request parameters for authorization decisions.

## Audit Logging
See database-architecture.md `audit_logs` table. Minimum audited actions: employee create/modify, manual attendance creation, attendance correction request/approval/rejection, schedule/policy/location modification, QR/device configuration changes, device sync runs, face enrollment, permission changes. Each entry: actor, company, action, entity type/id, old/new data (redacted per below), timestamp, metadata (IP, request ID).

## Sensitive Data Handling
- **Biometric data**: raw face images/templates are never stored in this system's database or object storage unless a specific vendor contract and legal basis require it, and if so, encrypted at rest with restricted access and a documented retention policy. Default architecture stores only a `provider_reference_id` pointing to the vendor's own enrollment store (see verification-architecture.md). This significantly reduces the compliance burden (biometric data is regulated more strictly than most PII in many jurisdictions).
- **GPS coordinates**: stored as part of verification logs for audit purposes but not exposed in generic reporting exports; access restricted to HR/Admin roles.
- **Audit log redaction**: `old_data`/`new_data` snapshots must exclude password hashes, session tokens, and raw biometric payloads even when logging employee/user record changes.

## API Validation
Every API route handler validates input with a Zod schema before it reaches the service layer. Validation errors return `VALIDATION_ERROR` with field-level detail; they never reach the database layer to fail as a raw SQL error.

## Rate Limiting
Applied at minimum to: login, QR token generation/redemption, face verification attempts. Initial implementation: simple DB or in-memory token-bucket keyed by `(companyId, employeeId or IP)`; revisit with a shared store (Redis) once horizontally scaled — not needed at single-instance scale.

## Idempotency
See attendance-architecture.md Concurrency section and ADR-0009. Idempotency keys required on all attendance-event-creating endpoints (check-in, check-out, break start/end, QR check-in).

## Secure QR Tokens
- Tokens are server-generated random values; only a hash is stored (`token_hash`), the raw value is what's embedded in the QR code — mirrors a password-reset-token pattern.
- Short expiry (configurable, e.g., 30–60 seconds for a rotating display QR, or per-shift for a static location QR — company policy decides).
- Single-use: `used_at` set atomically on redemption inside the same transaction as event creation, preventing replay.
- Optionally bound to a `location_id` so redemption also validates the redeeming device isn't claiming an implausible location.

## Session Security
- httpOnly + Secure + SameSite cookies.
- Session table allows server-side revocation (logout-everywhere, admin-forced logout on role change).
- Session rotation on privilege change (role/company membership update invalidates existing sessions for that membership).

## CSRF
Since state-changing requests go through Next.js API route handlers using cookie-based sessions, standard CSRF mitigations apply: SameSite=Lax/Strict cookies as first line of defense, plus origin/referer header checks on mutating routes as defense in depth (Next.js doesn't provide this by default). Idempotency keys are a bonus mitigation but not a CSRF substitute.

## Environment Variables
`.env` never committed; `.env.example` documents required keys with placeholder values. Runtime config loaded and validated via a Zod schema in `src/config/` so the app fails fast on missing/malformed env vars at boot rather than at first use.
