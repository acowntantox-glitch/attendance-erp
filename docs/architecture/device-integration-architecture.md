# Device Integration Architecture

## Goal
Biometric attendance devices (fingerprint/face terminals from vendors like ZKTeco, eSSL, etc.) must feed the same Attendance Event pipeline as every other capture method, without the core system depending on any vendor's protocol.

## Components
- `attendance_devices` — registry of physical devices, per branch, per company.
- `attendance_device_users` — mapping of a vendor's internal device-user ID to an `employee_id`. Required because device-side user IDs are vendor-specific integers/codes with no inherent link to the ERP's employee records.
- `BiometricDeviceAdapter` (see verification-architecture.md) — vendor-specific implementation of punch retrieval + normalization, isolated from core logic.
- `attendance_import_batches` / `attendance_import_errors` — every sync run is tracked as a batch with counts and per-record errors, so partial failures (e.g., 50 of 200 punches map to unknown device users) are visible and actionable by HR/Admin rather than silently lost.

## Sync Flow
```
Device (vendor SDK/API/file export)
   → BiometricDeviceAdapter.fetchPunches()
   → mapUser() per punch (employee lookup)
   → normalize() → RawCapture (same shape as GPS/QR/Manual)
   → Attendance domain event-creation pipeline (same validation, same idempotency rules)
   → attendance_import_batches record updated with results
```

## Sync Triggering
Two supported modes, decided per device/vendor capability:
1. **Pull**: scheduled background job polls the device/vendor API periodically (see production-readiness.md for job infra).
2. **Push**: device or vendor middleware calls `/api/devices/sync` with a device-scoped credential when new punches are available.

Either mode converges on the same adapter + normalization step, so the Attendance domain is unaware of which trigger style was used.

## Failure Isolation
A device communication failure (offline device, vendor API timeout) must not block other capture methods or other devices. Each device's sync runs independently; failures are recorded in `attendance_import_batches.status` and surfaced to Admin, not silently retried indefinitely without backoff.

## Employee Mapping Integrity
Unmapped device users produce `attendance_import_errors`, never a best-guess/fuzzy match to an employee — misattributing a punch to the wrong employee is a worse failure mode than a missed punch, since it corrupts payroll-relevant data silently.
