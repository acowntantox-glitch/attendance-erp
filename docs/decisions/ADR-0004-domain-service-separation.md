# ADR-0004: Domain/Service Separation

## Status
Accepted

## Context
Business logic (validation, calculation, authorization decisions) must not live in API route handlers or be duplicated between the web app and a future mobile-facing API, and must not leak into UI components.

## Decision
Each domain exposes a single `service.ts` as its public interface. API route handlers are thin: authenticate, validate input with Zod, call the domain service, map the result/error to the API envelope. Repositories (`repository.ts`) are private to their domain and contain all Drizzle query code. Cross-domain calls happen only through another domain's service, never its repository or internal models.

## Consequences
- Positive: business rules (e.g., authorization checks, calculation logic) are defined once and apply identically whether called from a web route, a future mobile API, or a background job.
- Positive: repositories can be refactored/optimized without affecting consumers, since only the service's contract needs to stay stable.
- Negative: requires upfront discipline to avoid "shortcut" imports across domain boundaries; should be enforced with a lint rule once code exists (e.g., `eslint-plugin-boundaries`).
