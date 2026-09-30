import { describe, expect, it } from "vitest";
import {
  generateTemporaryPassword,
  hashPassword,
  isPasswordStrongEnough,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  validatePasswordPolicy,
  verifyPassword,
  verifyPasswordConstantTime,
} from "./password";

describe("password hashing", () => {
  it("hashes and verifies a correct password", async () => {
    const hash = await hashPassword("CorrectHorseBatteryStaple1!");
    expect(hash).not.toBe("CorrectHorseBatteryStaple1!");
    await expect(verifyPassword(hash, "CorrectHorseBatteryStaple1!")).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("CorrectHorseBatteryStaple1!");
    await expect(verifyPassword(hash, "WrongPassword")).resolves.toBe(false);
  });

  it("enforces a minimum password length", () => {
    expect(isPasswordStrongEnough("short")).toBe(false);
    expect(isPasswordStrongEnough("longenoughpassword")).toBe(true);
  });
});

describe("password policy (the single, centralized definition)", () => {
  it("enforces the length window exactly", () => {
    expect(validatePasswordPolicy("a".repeat(MIN_PASSWORD_LENGTH - 1)).ok).toBe(false);
    expect(validatePasswordPolicy("a".repeat(MIN_PASSWORD_LENGTH)).ok).toBe(true);
    expect(validatePasswordPolicy("a".repeat(MAX_PASSWORD_LENGTH)).ok).toBe(true);
    expect(validatePasswordPolicy("a".repeat(MAX_PASSWORD_LENGTH + 1)).ok).toBe(false);
  });

  it("does not force symbols or digits (length over composition)", () => {
    expect(validatePasswordPolicy("only lowercase letters here").ok).toBe(true);
  });

  it("rejects whitespace-only input, common passwords (case-insensitively) and the known dev seed password", () => {
    expect(validatePasswordPolicy(" ".repeat(12)).ok).toBe(false);
    expect(validatePasswordPolicy("Password123").ok).toBe(false);
    expect(validatePasswordPolicy("1234567890").ok).toBe(false);
    expect(validatePasswordPolicy("DevPassword123!").ok).toBe(false);
    expect(validatePasswordPolicy("DEVPASSWORD123!").ok).toBe(false);
  });

  it("rejects a password equal to the user's own email", () => {
    expect(validatePasswordPolicy("Someone@Example.com", { email: "someone@example.com" }).ok).toBe(false);
    expect(validatePasswordPolicy("Someone@Example.com").ok).toBe(true);
  });

  it("returns a human-readable reason and is deterministic", () => {
    const first = validatePasswordPolicy("short");
    expect(first).toEqual(validatePasswordPolicy("short"));
    expect(first.ok === false && first.reason).toMatch(/at least 10/);
  });

  it("isPasswordStrongEnough is exactly the policy verdict", () => {
    for (const candidate of ["short", "longenoughpassword", "Password123", "DevPassword123!"]) {
      expect(isPasswordStrongEnough(candidate)).toBe(validatePasswordPolicy(candidate).ok);
    }
  });
});

describe("temporary password generator", () => {
  it("produces four dash-separated groups of four unambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/);
      expect(validatePasswordPolicy(password).ok).toBe(true);
    }
  });

  it("is random: no collisions across many draws", () => {
    const draws = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()));
    expect(draws.size).toBe(500);
  });
});

describe("verifyPasswordConstantTime", () => {
  it("verifies against a real hash", async () => {
    const hash = await hashPassword("CorrectHorseBatteryStaple1!");
    await expect(verifyPasswordConstantTime(hash, "CorrectHorseBatteryStaple1!")).resolves.toBe(true);
    await expect(verifyPasswordConstantTime(hash, "wrong-password-value")).resolves.toBe(false);
  });

  it("returns false (never true) when there is no account hash, but still does the hashing work", async () => {
    await expect(verifyPasswordConstantTime(null, "anything-at-all")).resolves.toBe(false);
    await expect(verifyPasswordConstantTime(undefined, "CorrectHorseBatteryStaple1!")).resolves.toBe(false);
  });
});
