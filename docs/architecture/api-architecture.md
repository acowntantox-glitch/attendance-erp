# API Architecture

## Conventions
- Base path: `/api/<domain>/<resource>[/<action>]`, e.g. `/api/attendance/check-in`.
- Employee-facing attendance capture endpoints are separate from HR/admin management endpoints, which are separate from device synchronization endpoints (different auth models and rate-limit profiles):
  - `/api/attendance/*` — employee-facing capture + self-service history
  - `/api/hr/attendance/*` — HR register, corrections review/approval
  - `/api/devices/*` — device sync, requires device/service credentials, not a user session

## Planned Endpoints (design only, not implemented)
```
POST /api/attendance/check-in
POST /api/attendance/check-out
POST /api/attendance/break/start
POST /api/attendance/break/end
GET  /api/attendance/today
GET  /api/attendance/history
POST /api/attendance/corrections
GET  /api/attendance/corrections
POST /api/attendance/qr/token          (HR/Admin: generate a QR token for a location)
POST /api/attendance/qr/check-in       (Employee: redeem a scanned token)
POST /api/attendance/location/verify
POST /api/attendance/face/verify
POST /api/devices/sync                 (device/service auth, not user session)
```

## Request/Response Envelope
```ts
// Success
{ "success": true, "data": <payload> }

// Failure
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
```
Consistent envelope simplifies both the web client and future React Native client parsing logic.

## Validation
Every mutating route: Zod schema parses `req.json()` before any service call. GET routes with query params (e.g., `history?from=&to=`) also validate via Zod (date range bounds, pagination limits) to prevent unbounded queries.

## Authentication & Authorization per Route
- All `/api/attendance/*` and `/api/hr/*` routes require a valid session; `RequestContext` is derived from it (see security-architecture.md).
- `/api/devices/*` uses a separate credential (API key or mTLS, decided at implementation time) tied to a specific `attendance_devices` record, not a user session — a device is not a user.
- Authorization (role checks) happens in the domain service, not the route handler, so the rule is identical across callers.

## Idempotency
Mutating attendance-event endpoints require an `Idempotency-Key` header (or body field) on every capture request; server stores and returns the original response on a repeated key rather than creating a duplicate (see attendance-architecture.md).

## Rate Limiting
Applied per route group at the edge/middleware layer where sensitive: login, QR generation/redemption, face verification. Returns `429` with a consistent error envelope.

## Error Format
Domain/service errors are typed (see error-handling in security-architecture.md and below) and mapped to HTTP status + error code at the API boundary by a single shared mapper (`lib/errors/toApiError.ts`), so raw exceptions/database errors never leak to the client.

## Pagination
List endpoints (`history`, HR register, corrections list) use cursor or offset+limit pagination with a server-enforced max page size — never "return everything," given attendance history can span years.

## Mobile-Readiness
No endpoint depends on browser-only APIs at the server side (e.g., no assumption of `document`/`window`). GPS coordinates and images arrive as plain JSON/multipart fields, which both a browser client and a future React Native (Expo) client can produce identically. Face image capture is abstracted so the mobile app can send an image/descriptor the same way the web app does, going through the same `/api/attendance/face/verify` endpoint.
