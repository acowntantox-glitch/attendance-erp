import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";

export class AlreadyCheckedInError extends ConflictError {
  constructor() {
    super("This employee already has an open attendance session for this work date. Check out before checking in again.");
  }
}

export class NoOpenSessionError extends BusinessRuleError {
  constructor() {
    super("There is no open attendance session to act on.");
  }
}

export class OpenBreakExistsError extends BusinessRuleError {
  constructor() {
    super("An open break must be ended before checking out.");
  }
}

export class NoOpenBreakError extends BusinessRuleError {
  constructor() {
    super("There is no open break to end.");
  }
}

export class DuplicateAttendanceEventError extends ConflictError {
  constructor() {
    super("This attendance event was already recorded (duplicate idempotency key).");
  }
}

export class AttendanceSessionNotFoundError extends NotFoundError {
  constructor() {
    super("Attendance session");
  }
}

export class AttendanceCorrectionNotFoundError extends NotFoundError {
  constructor() {
    super("Attendance correction");
  }
}

export class CorrectionAlreadyReviewedError extends BusinessRuleError {
  constructor() {
    super("This correction request has already been approved or rejected.");
  }
}

export class InvalidCorrectionEventError extends BusinessRuleError {
  constructor() {
    super("The referenced attendance event does not exist, does not belong to this employee/work date, or does not match the field being corrected.");
  }
}

export class InvalidCorrectionTargetError extends BusinessRuleError {
  constructor(message: string) {
    super(message);
  }
}

export class ConflictingCorrectionError extends ConflictError {
  constructor() {
    super("Another pending or approved correction already targets this same field for this employee and work date.");
  }
}

export class RecalculationFailedError extends BusinessRuleError {
  constructor() {
    super("Approving this correction would leave the recalculated attendance record in an inconsistent state. The correction was not approved.");
  }
}

export class EmployeeNotEligibleForProcessingError extends BusinessRuleError {
  constructor() {
    super("This employee is not eligible for attendance processing on this date (archived, inactive, or not yet employed).");
  }
}

// ---------------------------------------------------------------------------
// Attendance period closing/locking (Batch 8)
// ---------------------------------------------------------------------------

export class AttendancePeriodNotFoundError extends NotFoundError {
  constructor() {
    super("Attendance period");
  }
}

export class AttendancePeriodAlreadyClosedError extends BusinessRuleError {
  constructor() {
    super("This attendance period is already closed.");
  }
}

export class AttendancePeriodAlreadyOpenError extends BusinessRuleError {
  constructor() {
    super("This attendance period is already open.");
  }
}

export class AttendancePeriodHasOpenSessionsError extends BusinessRuleError {
  constructor(openSessionCount: number) {
    super(
      `This period cannot be closed while ${openSessionCount} attendance session${openSessionCount === 1 ? " is" : "s are"} still open. Resolve ${openSessionCount === 1 ? "it" : "them"} (check out normally, or through a correction) before closing.`,
    );
  }
}

/** Thrown by `assertAttendancePeriodOpen` — the single centralized guard every attendance
 *  mutation (check-in/out, breaks, processing, recalculation, corrections) calls before writing
 *  anything, whenever the work date's calendar month is CLOSED. */
export class AttendancePeriodLockedError extends BusinessRuleError {
  constructor(periodMonth: string) {
    super(`The attendance period for ${periodMonth} is closed. Reopen it first if this change is genuinely required.`);
  }
}

// ---------------------------------------------------------------------------
// Attendance exception management (Batch 10)
// ---------------------------------------------------------------------------

/** Thrown when the caller asks to dismiss an (employeeId, workDate, exceptionType) combination
 *  that isn't actually a live exception right now, per `attendance_daily_records` — dismissal
 *  metadata may never be inserted for a fact that doesn't currently hold (§9: "do not allow a
 *  user to dismiss a nonexistent exception merely by inserting a row"). */
export class AttendanceExceptionNotFoundError extends NotFoundError {
  constructor() {
    super("Attendance exception");
  }
}

/** Thrown by undismiss when no dismissal row exists for the given (employeeId, workDate,
 *  exceptionType) — nothing to remove. */
export class AttendanceExceptionDismissalNotFoundError extends NotFoundError {
  constructor() {
    super("Attendance exception dismissal");
  }
}
