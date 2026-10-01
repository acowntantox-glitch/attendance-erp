export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BUSINESS_RULE_VIOLATION"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "PASSWORD_CHANGE_REQUIRED";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, httpStatus: number, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = "The request contains invalid data.", details?: unknown) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication is required.") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super("FORBIDDEN", message, 403);
  }
}

/**
 * F-24 - a denial that must NOT reveal whether the thing exists: the resource belongs to another company, or a
 * manager asks about someone outside their team. Internally it is still an AuthorizationError (so existing
 * handling and tests are unchanged); at the API boundary it is answered exactly like a missing resource
 * (404, same body), so a caller cannot tell "does not exist" from "exists but not yours".
 */
export class ResourceHiddenError extends AuthorizationError {}

export class NotFoundError extends AppError {
  constructor(entity: string, message = `${entity} was not found.`) {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = "The request conflicts with existing data.") {
    super("CONFLICT", message, 409);
  }
}

export class BusinessRuleError extends AppError {
  constructor(message: string) {
    super("BUSINESS_RULE_VIOLATION", message, 422);
  }
}

/** 429 — too many attempts in a bounded window. The message is deliberately generic. */
export class TooManyRequestsError extends AppError {
  constructor(message = "Too many attempts. Please wait a few minutes and try again.") {
    super("RATE_LIMITED", message, 429);
  }
}

/** 403 — the account is signed in but must set a new password (e.g. after an admin reset) before
 *  it may use anything else. Carries its own code so the UI can route to the change-password page. */
export class PasswordChangeRequiredError extends AppError {
  constructor() {
    super("PASSWORD_CHANGE_REQUIRED", "You must change your password before continuing.", 403);
  }
}

export class InternalError extends AppError {
  constructor(message = "An unexpected error occurred.") {
    super("INTERNAL_ERROR", message, 500);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "This feature is not available right now.") {
    super("SERVICE_UNAVAILABLE", message, 503);
  }
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * node-postgres attaches the SQL error `code` to the thrown error, but drizzle-orm wraps that
 * in a `DrizzleQueryError` and moves the original onto `.cause` — so the code has to be checked
 * at both levels. Used by domain services to translate a DB-level unique constraint violation
 * into a typed ConflictError subclass instead of leaking a raw driver error.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const err = error as { code?: string; cause?: { code?: string } };
  return err.code === POSTGRES_UNIQUE_VIOLATION || err.cause?.code === POSTGRES_UNIQUE_VIOLATION;
}
