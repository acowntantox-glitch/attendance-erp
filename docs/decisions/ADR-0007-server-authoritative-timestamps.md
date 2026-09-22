# ADR-0007: Server-Authoritative Timestamps

## Status
Accepted

## Context
Client devices (browsers, mobile phones, biometric terminals) can have incorrect or manipulated clocks. Attendance timestamps directly affect payroll and must not be trustable-by-client, or an employee could spoof an earlier check-in / later check-out time.

## Decision
For GPS, QR, and Face capture methods, `captured_at` is set to server time at the moment the request is validated and accepted, not a client-supplied timestamp. For biometric devices, the device's own timestamp is used only if the device is a trusted, time-synced piece of hardware under company control, and is still recorded alongside a server-received-at timestamp for audit/drift detection. For Manual HR entry, HR may explicitly backdate/adjust a timestamp, but this goes through the corrections workflow (an explicit, audited action) rather than being treated as a normal real-time capture.

## Consequences
- Positive: eliminates an entire class of client-clock-manipulation fraud for real-time capture methods.
- Positive: clear distinction between "real-time capture" (server time) and "HR-adjusted record" (explicit correction, audited).
- Negative: server and device clock drift (for biometric devices) must be monitored; large drift should be flagged rather than silently trusted.
