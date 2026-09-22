# ADR-0005: Provider Abstraction for Face Verification

## Status
Accepted

## Context
No face-recognition vendor has been selected. Vendors differ widely in API shape, pricing, and data-handling terms, and biometric data handling carries elevated legal/compliance risk (see security-architecture.md). Coupling the attendance engine directly to one vendor's SDK would make switching vendors or handling multiple concurrent vendors (e.g., different plans per company) costly.

## Decision
Define a `FaceVerificationProvider` interface (`enroll`, `verify`, `remove`) in the Verification domain. The Attendance domain and Calculation Engine depend only on this interface's result type, never on a vendor SDK directly. Raw biometric images/templates are not persisted in the ERP's own database; only a `provider_reference_id` is stored.

## Consequences
- Positive: vendor selection/switching is isolated to one adapter implementation; core attendance logic is unaffected.
- Positive: reduces compliance/legal exposure by avoiding local storage of raw biometric data.
- Negative: some vendor-specific capabilities (e.g., liveness detection nuances) may not map cleanly to a generic interface and may require interface extension later.
