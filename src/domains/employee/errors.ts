import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";

export class EmployeeNotFoundError extends NotFoundError {
  constructor() {
    super("Employee");
  }
}

export class DuplicateWorkEmailError extends ConflictError {
  constructor(workEmail: string) {
    super(`An employee with work email '${workEmail}' already exists in this company.`);
  }
}

export class DuplicateEmployeeNumberError extends ConflictError {
  constructor() {
    super("That employee number is already in use. Please try again.");
  }
}

export class SelfManagerError extends BusinessRuleError {
  constructor() {
    super("An employee cannot be their own manager.");
  }
}

export class CircularManagerHierarchyError extends BusinessRuleError {
  constructor() {
    super("This manager assignment would create a circular reporting relationship.");
  }
}

export class EmployeeHasActiveDirectReportsError extends BusinessRuleError {
  constructor(count: number) {
    super(
      `This employee currently manages ${count} employee${count === 1 ? "" : "s"}. ` +
        "Reassign all direct reports to another manager before archiving.",
    );
  }
}

export class InvalidManagerError extends BusinessRuleError {
  constructor(message = "The selected manager is not valid.") {
    super(message);
  }
}

export class InvalidUserLinkError extends BusinessRuleError {
  constructor(message = "The selected user account is not a member of this company.") {
    super(message);
  }
}

export class OnboardingNotFoundError extends NotFoundError {
  constructor() {
    super("Onboarding record");
  }
}

export class EmployeeDocumentNotFoundError extends NotFoundError {
  constructor() {
    super("Document");
  }
}
