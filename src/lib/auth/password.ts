import { randomBytes, randomInt } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/**
 * OWASP-recommended Argon2id parameters for interactive login (2024 cheat sheet baseline).
 * Tuned for a single-instance server; revisit if hashing latency becomes a bottleneck.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plainTextPassword: string): Promise<string> {
  return hash(plainTextPassword, ARGON2_OPTIONS);
}

export async function verifyPassword(hashedPassword: string, plainTextPassword: string): Promise<boolean> {
  return verify(hashedPassword, plainTextPassword);
}

// ---------------------------------------------------------------------------------------------
// Password policy — the ONE definition, used by change-password, admin reset and any future flow.
// Deliberately modest and deterministic: a length window plus a short blocklist of well-known bad
// passwords. No forced symbols/digits (length beats composition rules) and no password history.
// ---------------------------------------------------------------------------------------------

export const MIN_PASSWORD_LENGTH = 10;
/** Upper bound so an absurdly long input cannot be used to burn Argon2 CPU. */
export const MAX_PASSWORD_LENGTH = 128;

/** Lower-cased. Includes the well-known development seed password so it can never be set again. */
const BLOCKED_PASSWORDS: ReadonlySet<string> = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "passw0rd123",
  "1234567890",
  "12345678910",
  "qwertyuiop",
  "qwerty12345",
  "letmein123",
  "welcome123",
  "admin12345",
  "administrator",
  "iloveyou123",
  "devpassword123!",
  "devpassword123",
]);

export type PasswordPolicyResult = { ok: true } | { ok: false; reason: string };

export function validatePasswordPolicy(password: string, context: { email?: string } = {}): PasswordPolicyResult {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, reason: `Password must be at most ${MAX_PASSWORD_LENGTH} characters long.` };
  }
  if (password.trim().length === 0) {
    return { ok: false, reason: "Password cannot be only whitespace." };
  }
  const lowered = password.toLowerCase();
  if (BLOCKED_PASSWORDS.has(lowered)) {
    return { ok: false, reason: "This password is too common. Choose a different one." };
  }
  if (context.email && lowered === context.email.trim().toLowerCase()) {
    return { ok: false, reason: "Password cannot be the same as your email address." };
  }
  return { ok: true };
}

export function isPasswordStrongEnough(password: string): boolean {
  return validatePasswordPolicy(password).ok;
}

// No I, l, O, 0, 1, o — a temporary password is read aloud or typed from a screen.
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/**
 * A cryptographically random one-time password for an admin reset: 16 characters from a 56-symbol
 * alphabet (~92 bits), shown in four dash-separated groups. Uses `crypto.randomInt`, which is
 * unbiased. It always satisfies `validatePasswordPolicy`.
 */
export function generateTemporaryPassword(): string {
  const chars = Array.from({ length: 16 }, () => TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)]!);
  return [0, 4, 8, 12].map((start) => chars.slice(start, start + 4).join("")).join("-");
}

let dummyHashPromise: Promise<string> | null = null;

/**
 * Verifies `password` against `hashedPassword`, or — when there is no usable account — against a
 * throw-away hash, so an unknown/disabled account costs the same Argon2 work as a wrong password
 * and response timing does not reveal which emails exist. Always returns false for the dummy.
 */
export async function verifyPasswordConstantTime(hashedPassword: string | null | undefined, plainTextPassword: string): Promise<boolean> {
  if (hashedPassword) return verifyPassword(hashedPassword, plainTextPassword);
  dummyHashPromise ??= hashPassword(randomBytes(24).toString("base64url"));
  await verifyPassword(await dummyHashPromise, plainTextPassword);
  return false;
}
