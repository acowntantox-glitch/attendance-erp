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
