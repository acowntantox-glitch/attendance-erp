import { AuthenticationError } from "@/lib/errors";

export class InvalidCredentialsError extends AuthenticationError {
  constructor() {
    super("Invalid email or password.");
  }
}

export class NoCompanyContextError extends AuthenticationError {
  constructor() {
    super("This account is not an active member of any company. Contact your administrator.");
  }
}

export class AmbiguousCompanyContextError extends AuthenticationError {
  constructor() {
    super("This account belongs to multiple companies. Please specify which company to sign in to.");
  }
}
