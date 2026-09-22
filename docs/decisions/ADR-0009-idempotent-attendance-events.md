# ADR-0009: Idempotent Attendance Events

## Status
Accepted

## Context
Attendance capture is susceptible to race conditions and duplicate submissions: double-clicks, network retries, or simultaneous requests from multiple devices/tabs. A duplicate check-in/check-out event would corrupt payroll-relevant calculations (e.g., doubled working time or incorrect break duration).

## Decision
Every attendance-event-creating request carries a client-generated idempotency key. The database enforces a unique constraint on `(employee_id, idempotency_key)`; a repeated key returns the original result rather than creating a new event. Additionally, a partial unique index/transactional check prevents a second `CHECK_IN` while an employee has an open session (no matching `CHECK_OUT` yet), with event validation and insert wrapped in a single transaction using row-level locking to serialize concurrent requests for the same employee.

## Consequences
- Positive: duplicate submissions (double-click, retry) are handled safely and transparently to the client.
- Positive: correctness holds under horizontal scaling, since the guarantee is enforced by the database, not in-memory application state.
- Negative: requires every capture-method client (web, future mobile, QR flow) to correctly generate and pass an idempotency key; a client bug that reuses keys across genuinely distinct events would incorrectly suppress a real event, so key generation must be tied to a fresh user action, not cached/reused across actions.
