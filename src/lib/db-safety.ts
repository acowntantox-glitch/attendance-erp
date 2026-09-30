/**
 * Database-target safety for anything that can MUTATE data outside the running app: seeding,
 * migrations, and the integration-test suite. It answers one question — "is this DATABASE_URL a
 * local/test database?" — and FAILS CLOSED: anything it cannot positively identify as local is
 * refused unless an operator names that exact hostname in an override variable.
 *
 * Decisions are made on the PARSED HOSTNAME, never by substring-matching the URL, and never on
 * `NODE_ENV` alone (a developer's `.env.local` can point at production with `NODE_ENV=development`).
 * Nothing here ever includes the URL, credentials, or a password in a message — only the purpose,
 * the hostname, and the name of the override variable.
 *
 * Pure and dependency-free so it can be used from scripts, the vitest setup file, and unit tests.
 */

/** Hosts that are always considered local. `postgres` is the docker-compose / CI service name. */
export const LOCAL_DATABASE_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

export type DatabaseTarget =
  | { kind: "local"; host: string }
  | { kind: "remote"; host: string }
  | { kind: "invalid"; reason: string };

/**
 * Parses a connection string into a target. Never throws and never echoes the input.
 *
 * Deliberately conservative about ambiguity, because a misparsed host is exactly how a production
 * URL would be mistaken for a local one:
 *  - only postgres:// and postgresql:// are accepted;
 *  - more than one `@` (an unescaped `@` in a password) is refused as ambiguous;
 *  - libpq's `host=` / `hostaddr=` query parameters, which the pg driver honours OVER the URL
 *    authority, are refused — `postgresql://u:p@localhost/db?host=prod.example.com` connects to prod.
 */
export function classifyDatabaseUrl(databaseUrl: string | undefined | null): DatabaseTarget {
  if (!databaseUrl || databaseUrl.trim().length === 0) return { kind: "invalid", reason: "DATABASE_URL is not set" };

  const raw = databaseUrl.trim();
  if ((raw.match(/@/g) ?? []).length > 1) {
    return { kind: "invalid", reason: "DATABASE_URL is ambiguous (more than one '@'; URL-encode special characters in the password)" };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "invalid", reason: "DATABASE_URL is not a valid URL" };
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return { kind: "invalid", reason: "DATABASE_URL is not a postgres:// or postgresql:// URL" };
  }
  if (url.searchParams.has("host") || url.searchParams.has("hostaddr")) {
    return { kind: "invalid", reason: "DATABASE_URL overrides the host through a query parameter" };
  }

  // WHATWG URL keeps IPv6 literals in brackets ("[::1]"); normalize and lowercase.
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host.length === 0) return { kind: "invalid", reason: "DATABASE_URL has no host" };

  return LOCAL_DATABASE_HOSTS.has(host) ? { kind: "local", host } : { kind: "remote", host };
}

export class UnsafeDatabaseTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDatabaseTargetError";
  }
}

export type AssertSafeDatabaseTargetOptions = {
  /** What is about to touch the database, e.g. "database seed" / "integration tests" — appears in the error. */
  purpose: string;
  databaseUrl: string | undefined | null;
  nodeEnv?: string | undefined;
  /** Refuse whenever NODE_ENV is "production" (seed/tests). Migrations must NOT set this: the real
   *  deployment legitimately runs with NODE_ENV=production. */
  refuseProductionNodeEnv?: boolean;
  /** The value of the operator's override variable. A remote host is allowed ONLY if it equals the
   *  parsed hostname exactly (case-insensitive) — never a blanket bypass. */
  allowedRemoteHost?: string | undefined;
  /** Name of that variable, for the error message. */
  overrideVariable?: string;
  /** Wording for the "why refused" sentence; defaults to a generic non-local statement. */
  remoteRefusal?: string;
};

/**
 * Throws `UnsafeDatabaseTargetError` unless the target is safe to mutate. Returns the (non-secret)
 * hostname it approved.
 */
export function assertSafeDatabaseTarget(options: AssertSafeDatabaseTargetOptions): { host: string } {
  const { purpose, databaseUrl, nodeEnv, refuseProductionNodeEnv, allowedRemoteHost, overrideVariable, remoteRefusal } = options;

  if (refuseProductionNodeEnv && nodeEnv === "production") {
    throw new UnsafeDatabaseTargetError(`Refusing to run ${purpose}: NODE_ENV is "production".`);
  }

  const target = classifyDatabaseUrl(databaseUrl);

  if (target.kind === "invalid") {
    throw new UnsafeDatabaseTargetError(`Refusing to run ${purpose}: ${target.reason}.`);
  }
  if (target.kind === "local") return { host: target.host };

  if (allowedRemoteHost && allowedRemoteHost.trim().toLowerCase() === target.host) {
    return { host: target.host };
  }

  const hint = overrideVariable
    ? ` To confirm you intend to target this host, set ${overrideVariable} to exactly "${target.host}".`
    : "";
  throw new UnsafeDatabaseTargetError(
    `Refusing to run ${purpose} against a production database. ${remoteRefusal ?? `Host "${target.host}" is not a local/test database (allowed local hosts: ${[...LOCAL_DATABASE_HOSTS].join(", ")}).`}${hint}`,
  );
}
