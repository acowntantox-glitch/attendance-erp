# ADR-0002: PostgreSQL as Primary Database

## Status
Accepted

## Context
Attendance data requires strong consistency guarantees: unique constraints to prevent duplicate events, transactional multi-table writes (event + daily record recalculation), and row-level locking to serialize concurrent check-in attempts. Reporting also requires relational joins across organization/employee/workforce/attendance data.

## Decision
Use PostgreSQL as the sole primary datastore, accessed via Drizzle ORM.

## Consequences
- Positive: native support for unique/partial-unique constraints, transactions, and `SELECT ... FOR UPDATE` row locking directly supports the concurrency strategy in attendance-architecture.md.
- Positive: mature ecosystem, easy to self-host or use a managed provider (RDS, Cloud SQL, Supabase, Neon), no vendor lock-in.
- Positive: JSONB columns provide flexibility for semi-structured fields (settings, metadata, break_rules) without abandoning relational integrity elsewhere.
- Negative: not inherently multi-region/globally distributed; acceptable at current scale, revisit only if geographic distribution becomes a requirement.
