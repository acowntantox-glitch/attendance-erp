# ADR-0006: Adapter Architecture for Biometric Devices

## Status
Accepted

## Context
Biometric attendance terminals (fingerprint/face devices) come from many vendors (e.g., ZKTeco, eSSL) with incompatible protocols/SDKs and vendor-specific internal user IDs unrelated to the ERP's employee records.

## Decision
Define a `BiometricDeviceAdapter` interface (`fetchPunches`, `mapUser`, `normalize`) per vendor. All vendor-specific communication logic lives behind this adapter. Adapters normalize punches into the same `RawCapture` shape used by every other capture method (GPS, QR, Manual, Face) before handing off to the common Attendance event pipeline.

## Consequences
- Positive: new device vendors can be supported by adding a new adapter implementation without touching the Attendance domain.
- Positive: the core system never depends on vendor SDKs directly, simplifying testing (mock adapters) and reducing vendor lock-in.
- Negative: unmapped device users must be surfaced as import errors rather than guessed, which requires an admin workflow to resolve mapping gaps (see device-integration-architecture.md).
