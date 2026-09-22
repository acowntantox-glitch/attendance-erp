# ADR-0003: Attendance Events as Source of Truth

## Status
Accepted

## Context
The final "daily attendance" figure (present/late/hours worked) is a derived calculation, not a raw fact. If only the derived figure is stored, correcting a mistake or changing a policy (e.g., a grace-period change) cannot be reliably reapplied to historical data, and there is no audit trail of what actually happened minute-by-minute.

## Decision
Raw attendance events (`attendance_events`) are immutable and append-only, representing exactly what was captured (check-in, check-out, break start/end) regardless of capture method. `attendance_daily_records` are derived/calculated data, produced by the Calculation Engine from events + workforce configuration, and are recalculable at any time without touching the underlying events.

## Consequences
- Positive: corrections and policy changes can be reapplied by recalculating from the same immutable events, preserving a full audit trail of what was actually captured vs. what was decided/approved.
- Positive: supports the calculation-version field on daily records, enabling reprocessing when the calculation engine logic changes.
- Negative: requires a background/on-demand recalculation mechanism and careful handling of "which version of the calculation logic produced this record" for auditability.
- Negative: slightly more storage and query complexity than storing only final daily summaries.
