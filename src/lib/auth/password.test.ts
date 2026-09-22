import { describe, expect, it } from "vitest";
import { hashPassword, isPasswordStrongEnough, verifyPassword } from "./password";

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
