export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BUSINESS_RULE_VIOLATION"
  | "INTERNAL_ERROR";

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

export class InternalError extends AppError {
  constructor(message = "An unexpected error occurred.") {
    super("INTERNAL_ERROR", message, 500);
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
