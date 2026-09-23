import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";

export class WorkScheduleNotFoundError extends NotFoundError {
  constructor() {
    super("Work schedule");
  }
}

export class ShiftNotFoundError extends NotFoundError {
  constructor() {
    super("Shift");
  }
}

export class EmployeeScheduleAssignmentNotFoundError extends NotFoundError {
  constructor() {
    super("Schedule assignment");
  }
}

export class WeeklyOffRuleNotFoundError extends NotFoundError {
  constructor() {
    super("Weekly off rule");
  }
}

export class HolidayNotFoundError extends NotFoundError {
  constructor() {
    super("Holiday");
  }
}

export class DuplicateWorkScheduleNameError extends ConflictError {
  constructor(name: string) {
    super(`A work schedule named '${name}' already exists in this company.`);
  }
}

export class DuplicateShiftCodeError extends ConflictError {
  constructor(code: string) {
    super(`A shift with code '${code}' already exists in this company.`);
  }
}

export class DuplicateHolidayError extends ConflictError {
  constructor() {
    super("A holiday already exists for this date and scope.");
  }
}

export class ScheduleHasActiveAssignmentsError extends BusinessRuleError {
  constructor() {
    super("This work schedule has active employee assignments. Reassign them before archiving.");
  }
}

export class ShiftHasActiveAssignmentsError extends BusinessRuleError {
  constructor() {
    super("This shift has active employee assignments. Reassign them before archiving.");
  }
}

export class OverlappingScheduleAssignmentError extends ConflictError {
  constructor() {
    super(
      "This date range overlaps an existing schedule assignment for this employee. " +
        "Pass allowOverlap with a note to override explicitly.",
    );
  }
}

export class InvalidAssignmentDateRangeError extends BusinessRuleError {
  constructor(message = "effectiveTo must be on or after effectiveFrom.") {
    super(message);
  }
}

export class OverlappingWeeklyOffOverrideError extends ConflictError {
  constructor() {
    super(
      "This effective date is on or before the employee's current weekly-off override start date. " +
        "Close or adjust the existing override before starting a new one at this date.",
    );
  }
}

export class ImmutableAssignmentFieldError extends BusinessRuleError {
  constructor() {
    super(
      "employeeId, workScheduleId, shiftId, and effectiveFrom cannot be changed on an existing " +
        "assignment. Close this assignment and create a new one instead.",
    );
  }
}
