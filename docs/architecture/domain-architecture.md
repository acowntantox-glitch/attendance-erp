# Domain Architecture

## Domain Flow
```
Organization
  ↓
Employee
  ↓
Workforce Configuration (schedules, shifts, policies)
  ↓
Attendance (events)
  ↓
Verification (GPS / Face / QR / Biometric)
  ↓
Attendance Events (normalized)
  ↓
Calculation Engine
  ↓
Daily Attendance Record
  ↓
Reports / Payroll Integration
```

## Domain Definitions

### Organization
Owns: companies, branches, departments, locations.
Responsibility: tenant root. Every other domain's records ultimately trace back to a `company_id` owned here. Branches/locations carry geo-coordinates used by GPS verification.

### Employee
Owns: employee records, employment status, assignment to branch/department/designation.
Responsibility: identity of the person being tracked. Does not know about attendance mechanics — only who they are and where they belong organizationally.

### Workforce
Owns: work schedules, schedule days, shifts (including overnight), holidays, attendance policies (grace period, minimum hours, overtime rules), employee-to-schedule assignment.
Responsibility: defines the *expected* pattern of work an employee should follow. The Calculation Engine reads from this domain to know what "on time" means for a given employee on a given date.

### Attendance
Owns: attendance events (immutable), daily attendance records (derived), corrections, audit trail of attendance-specific actions.
Responsibility: the core ledger. Split internally into:
- **Event capture** — accepts normalized events from any verification method.
- **Calculation Engine** — pure functions that turn a day's events + workforce config into a daily record.
- **Corrections** — HR-driven amendment workflow that never mutates raw events, only appends correction records and re-triggers calculation.

### Verification
Owns: verification interfaces and their concrete strategies (GPS distance check, Face provider, QR token issuance/validation), verification logs.
Responsibility: decides *whether a capture attempt is trustworthy*, independent of what happens once trusted. Produces a verification result consumed by the Attendance domain when creating an event. Does not itself write attendance events.

### Devices
Owns: biometric device registration, device-to-employee user mapping, import batches, import errors.
Responsibility: normalizes vendor-specific punch data into the same event shape used by GPS/QR/manual/face, then hands off to Attendance domain exactly like any other capture method.

### Reporting
Owns: read-optimized queries/views over daily attendance records for registers, analytics, payroll export.
Responsibility: consumes only calculated (derived) data — never raw events directly — so reports always reflect the same calculation logic used operationally.

### Audit
Owns: audit log storage and query API.
Responsibility: cross-cutting — other domains call `AuditService.record(...)` after sensitive mutations (see security-architecture.md for the list). Audit domain does not know business meaning, only stores structured entries.

### Authentication / Authorization
Owns: sessions, credentials, roles, permissions, company-membership for the acting user.
Responsibility: establishes *who* is acting and *within which company/role* — every other domain's service methods receive an authenticated/authorized context object rather than trusting caller-supplied identifiers.

## Cross-Domain Rule
A domain may depend "downward" only in the order listed above (e.g., Attendance may call Workforce and Employee services; Workforce must not call Attendance). This keeps the dependency graph acyclic and mirrors the conceptual flow, which is what makes the Calculation Engine free of knowledge about capture methods (see attendance-architecture.md).
