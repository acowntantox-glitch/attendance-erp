import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";

export class DuplicateCodeError extends ConflictError {
  constructor(entity: string, code: string) {
    super(`A ${entity} with code '${code}' already exists in this company.`);
  }
}

export class CompanyNotFoundError extends NotFoundError {
  constructor() {
    super("Company");
  }
}

export class BranchNotFoundError extends NotFoundError {
  constructor() {
    super("Branch");
  }
}

export class DepartmentNotFoundError extends NotFoundError {
  constructor() {
    super("Department");
  }
}

export class LocationNotFoundError extends NotFoundError {
  constructor() {
    super("Location");
  }
}

export class DesignationNotFoundError extends NotFoundError {
  constructor() {
    super("Designation");
  }
}

export class CircularDepartmentHierarchyError extends BusinessRuleError {
  constructor() {
    super("A department cannot be its own ancestor. Choose a different parent department.");
  }
}

export class DepartmentHasActiveEmployeesError extends BusinessRuleError {
  constructor() {
    super("This department has active employees assigned to it. Reassign them before archiving.");
  }
}

export class DesignationHasActiveEmployeesError extends BusinessRuleError {
  constructor() {
    super("This designation has active employees assigned to it. Reassign them before archiving.");
  }
}

export class BranchHasActiveEmployeesError extends BusinessRuleError {
  constructor() {
    super("This location has active employees assigned to it. Reassign them before archiving.");
  }
}
