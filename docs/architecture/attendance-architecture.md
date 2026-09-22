# Attendance Architecture

## Core Rule
No capture method (GPS, Face, QR, Biometric, Manual HR) is allowed to have its own attendance table, its own status calculation, or its own "daily record" concept. All methods converge into one pipeline:

```
Capture Method  →  Verification  →  Validation  →  Attendance Event  →  Attendance Engine
                                                                          ↓
                                                                 Calculation Engine
                                                                          ↓
                                                                 Daily Attendance Record
                                                                          ↓
                                                                 Reports / Payroll
```

### Capture Method (per method, isolated)
- **Manual HR**: HR selects employee + event type + timestamp (server validates HR has permission; timestamp defaults to server time, backdating requires a correction workflow, not a raw event).
- **GPS**: client sends coordinates + accuracy; `LocationVerificationService` validates against the employee's assigned location/branch radius.
- **GPS + Face**: GPS validation above, plus `FaceVerificationProvider.verify()` against enrolled template.
- **QR**: `QRTokenService` validates token signature, expiry, and single-use, optionally combined with GPS of the QR display device.
- **Biometric**: `BiometricDeviceAdapter` retrieves vendor punches, maps device user ID → employee ID, normalizes to the common event shape.

Each capture method produces the same intermediate shape before touching the Attendance domain:
```ts
type RawCapture = {
  employeeId: string;
  companyId: string;
  eventType: "CHECK_IN" | "CHECK_OUT" | "BREAK_START" | "BREAK_END";
  capturedAt: Date;        // server-authoritative, see ADR-0007
  method: "MANUAL" | "GPS" | "GPS_FACE" | "QR" | "BIOMETRIC";
  verification: VerificationResult; // from Verification domain
  sourceMetadata: Record<string, unknown>; // device id, coordinates, qr token id, etc. — for audit only
};
```

### Verification
Verification is a **gate**, not a data store for attendance. It returns pass/fail + evidence. The Attendance domain decides whether a failed verification blocks event creation (configurable per company policy — e.g., some companies may allow "GPS outside radius" to create a flagged event pending HR approval rather than hard-rejecting).

### Validation (inside Attendance domain, before persisting an event)
- Duplicate/idempotency check (see Concurrency section, and ADR-0009).
- Sequence validity (e.g., cannot BREAK_END without prior BREAK_START; cannot CHECK_IN if an open session already exists, unless policy allows multiple sessions/day).
- Company/employee active-status check.

### Attendance Event (immutable, source of truth)
Stored exactly as captured. Never edited. Corrections do not mutate events — they create a `attendance_corrections` record referencing the day, and (if approved) the calculation engine is re-run incorporating the correction as an additional synthetic event or an override input (design choice made at implementation time; documented here as a constraint: **raw device/GPS/QR/face events are never rewritten**).

### Attendance Engine
Thin orchestrator: given a `companyId` + `employeeId` + `date`, loads all events for that day (raw + approved corrections) and invokes the Calculation Engine. Triggered either synchronously (on check-out, for immediate feedback) or via background job (nightly batch recompute, correction approval, schedule change backfill).

### Calculation Engine
Pure, deterministic function set: `(events[], scheduleForDay, policy) → DailyAttendanceRecord`. No I/O, no knowledge of capture method. This is what makes it unit-testable in isolation (see testing-strategy.md).

Inputs it needs from Workforce domain:
- Expected shift start/end (including overnight handling — a shift crossing midnight is associated with the day it *starts*).
- Break rules (paid/unpaid, expected duration).
- Grace period (minutes late still counted on-time).
- Minimum working hours for a full/half day.
- Overtime threshold and rounding rules.
- Holiday/weekend/off-day flag for the date (from Workforce holiday calendar + schedule days).

Outputs (Daily Attendance Record fields):
- Gross time (first event to last event).
- Break time (sum of BREAK_START→BREAK_END pairs).
- Working time (gross − break).
- Late minutes (max(0, actualStart − expectedStart − grace)).
- Early departure minutes.
- Overtime minutes.
- Status enum: `PRESENT`, `ABSENT`, `HALF_DAY`, `LATE`, `ON_LEAVE`, `HOLIDAY`, `WEEK_OFF`, `INCOMPLETE` (missing checkout).

### Edge Cases the Engine Must Handle (documented now, implemented later)
- Missing checkout → mark `INCOMPLETE`, do not silently fabricate a checkout time; surface for HR correction.
- Duplicate punches within a debounce window (e.g., same device double-fire) → collapse in validation, not silently in calculation.
- Invalid sequences (e.g., two consecutive CHECK_IN with no CHECK_OUT) → flagged, not calculated, pending HR review.
- Overnight shifts → date attribution rule fixed as "day the shift starts"; calculation spans midnight explicitly using UTC-normalized timestamps + shift-day-start.
- Holidays/Weekends/Off-days → engine short-circuits to the appropriate status unless events exist (e.g., employee voluntarily worked a holiday → still calculate overtime).
- Leave → treated as an external input from a (future) Leave domain; for Phase 0 this is a placeholder status.

## Concurrency & Idempotency
Problem: double-click / duplicate network retry on Check-In must not create two events.
Strategy (documented for implementation phase):
1. **Client idempotency key** — each capture request carries a client-generated UUID; server enforces a unique constraint on `(employee_id, idempotency_key)` and returns the original result on retry rather than erroring.
2. **Database constraint** — partial unique index preventing two `CHECK_IN` events for the same `employee_id` within an "open session" (no matching CHECK_OUT yet), enforced at the DB level, not just application logic.
3. **Transaction** — event validation + insert happens in a single DB transaction with `SELECT ... FOR UPDATE` on the employee's current-day session row (or equivalent) to serialize concurrent requests from the same employee.
4. Cross-request race between two different servers/instances is handled by the DB constraint, not in-memory locks (in-memory locks do not work across horizontally scaled instances).

See ADR-0009.
