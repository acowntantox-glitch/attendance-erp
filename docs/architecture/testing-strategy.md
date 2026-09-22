# Testing Strategy

## Levels

### Unit Tests (Vitest)
Target pure/deterministic logic with no I/O:
- Calculation Engine (attendance-architecture.md): late minutes, overtime, break time, overnight shift date attribution, missing-checkout handling, holiday/weekend short-circuits — table-driven tests covering each edge case listed in attendance-architecture.md.
- Distance calculation (`LocationVerificationService`'s haversine + radius comparison).
- QR token validation logic (expiry, single-use, hash comparison) — with mocked storage.
- Attendance event sequence validation (e.g., BREAK_END without BREAK_START rejected).
- Schedule/shift resolution logic (given a date, resolve expected shift accounting for overnight shifts and schedule assignment history).

### Integration Tests (Vitest + real Postgres, e.g., via a disposable test database/container)
- Repository layer queries against actual schema/migrations (catches Drizzle query bugs that mocks would hide).
- Attendance API routes end-to-end within the Next.js server (request → validation → service → DB → response), including auth/authorization enforcement (a MANAGER cannot approve their own correction, an EMPLOYEE of Company A cannot read Company B's data).
- Transaction/concurrency behavior: simulate two simultaneous check-in requests and assert only one event is created (validates ADR-0009's idempotency + DB constraint design).
- Multi-company isolation: seed two companies with overlapping employee codes/data shapes and assert queries never cross the boundary.

### End-to-End Tests (Playwright)
Full user journeys through the actual UI:
- Employee check-in → break → check-out (manual/web flow).
- QR attendance flow (mocked camera/QR scan input).
- GPS attendance flow (mocked geolocation API).
- HR manual attendance creation and correction approval workflow.
- Admin: schedule/policy configuration, device registration.
- Auth: login, role-restricted page access, session expiry behavior.

## What Requires Which Level
| Area | Unit | Integration | E2E |
|---|---|---|---|
| Calculation engine | Required | — | — |
| GPS distance/radius | Required | Optional (real DB lookup path) | Optional (happy path) |
| QR token lifecycle | Required | Required (DB-backed single-use) | Optional (happy path) |
| Face verification | Required (mocked provider) | Required (provider interface contract) | Optional (mocked camera) |
| Biometric device sync | Required (normalization) | Required (mapping + import batch) | Not typically |
| RBAC/tenant isolation | — | Required | Spot-checked |
| Attendance APIs | — | Required | Key happy paths |
| Corrections workflow | — | Required | Required (HR-facing critical path) |

## Test Data & Fixtures
`src/tests/` holds shared fixtures (seed companies/employees/schedules) so integration and E2E tests don't hand-roll setup per test. Fixtures are deterministic, not randomly generated, so failures are reproducible.

## CI Expectation (for a later phase)
Unit + integration tests run on every push; E2E runs at minimum on PRs targeting main / before deploy, given browser test cost. Exact CI provider/config is deferred — no GitHub Actions workflow exists yet in this empty repository.
