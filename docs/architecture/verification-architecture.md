# Verification Architecture

All verification strategies implement a narrow interface so the Attendance domain never depends on a specific vendor or technique.

## GPS — `LocationVerificationService`
```ts
interface LocationVerificationService {
  verify(input: {
    employeeId: string;
    companyId: string;
    latitude: number;
    longitude: number;
    accuracyMeters: number;
  }): Promise<{
    passed: boolean;
    distanceMeters: number;
    matchedLocationId?: string;
    reason?: string;
  }>;
}
```
Responsibilities: look up employee's assigned branch/location(s), compute haversine distance, compare against configured radius, reject if `accuracyMeters` is implausibly poor (e.g., > configurable threshold, to prevent spoofed low-accuracy GPS from passing). Pure server-side computation — client-reported "inside radius" claims are never trusted (see security-architecture.md).

## Face — `FaceVerificationProvider`
```ts
interface FaceVerificationProvider {
  enroll(employeeId: string, sample: FaceSample): Promise<{ referenceId: string }>;
  verify(employeeId: string, sample: FaceSample): Promise<{ passed: boolean; score?: number; reason?: string }>;
  remove(employeeId: string): Promise<void>;
}
```
The core attendance engine depends only on this interface, not on a specific vendor SDK (e.g., AWS Rekognition, Azure Face, on-prem model). This is required both for vendor flexibility and because raw biometric templates should not be stored in the ERP's own database — see security-architecture.md. `FaceSample` is an opaque type (image bytes or provider-specific descriptor); its exact shape is decided when a vendor is selected.

## QR — `QRTokenService`
```ts
interface QRTokenService {
  generate(input: { companyId: string; locationId: string; expiresInSeconds: number }): Promise<{ token: string; expiresAt: Date }>;
  validateAndConsume(input: { token: string; employeeId: string }): Promise<{ passed: boolean; locationId?: string; reason?: string }>;
}
```
Responsibilities: cryptographically random token generation, hash-only storage, expiry enforcement, single-use enforcement (atomic consume), optional binding to a location for a secondary GPS check. See security-architecture.md for the replay-prevention pattern.

## Biometric — `BiometricDeviceAdapter`
```ts
interface BiometricDeviceAdapter {
  fetchPunches(deviceId: string, since: Date): Promise<RawDevicePunch[]>;
  mapUser(deviceId: string, deviceUserId: string): Promise<{ employeeId: string } | null>;
  normalize(punch: RawDevicePunch): RawCapture; // shape defined in attendance-architecture.md
}
```
Vendor-specific communication (SDK calls, proprietary protocols, file-based export/import) is implemented per-vendor behind this adapter; the Attendance/Devices domain only calls the adapter interface. Unmapped device users produce import errors (`attendance_import_errors`), not silently dropped or misattributed punches.

## Verification Result → Attendance Event
Every verification strategy returns a normalized `VerificationResult { passed, reason?, evidence metadata }`. The Attendance domain's event-creation validation step is the single place that decides, per company policy, whether a failed verification blocks event creation outright or creates a flagged event pending HR review. This keeps policy decisions out of each verification strategy.
