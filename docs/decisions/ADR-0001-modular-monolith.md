# ADR-0001: Modular Monolith Architecture

## Status
Accepted

## Context
The system has many tightly coupled domains (Organization → Employee → Workforce → Attendance → Calculation → Reporting) that share transactions and read/write in a single logical flow (e.g., creating an attendance event needs employee, workforce policy, and verification data together, atomically). The team is a single team building a new product, not multiple teams needing independent deployability yet.

## Decision
Build as a single Next.js deployable containing all domains, organized as a modular monolith: each domain lives in its own folder under `src/domains/` with a single public `service.ts` entry point, no cross-domain access to internal repositories/models.

## Consequences
- Positive: no distributed transactions needed for invariants like duplicate-check-in prevention; simpler deployment, debugging, and local development; faster initial delivery.
- Positive: clean domain boundaries mean any domain (e.g., Reporting or Device Sync) can be extracted into a separate service later if load or team structure demands it, without a full rewrite.
- Negative: requires discipline (and eventually lint enforcement) to prevent domains from reaching into each other's internals, or the "modular" boundary erodes over time.
- Negative: a single deployable means all domains scale together initially; if one domain (e.g., device sync) has very different load characteristics, it may need extraction sooner than expected.
