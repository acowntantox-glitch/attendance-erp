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

const MIN_PASSWORD_LENGTH = 10;

export function isPasswordStrongEnough(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}
