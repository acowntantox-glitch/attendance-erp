import { ConflictError, NotFoundError } from "@/lib/errors";

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
