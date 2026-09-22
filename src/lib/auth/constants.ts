/**
 * Deliberately dependency-free (no Node built-ins, no DB client) so it can be imported from
 * edge-runtime code such as middleware without pulling in `pg`/`node:crypto`.
 */
export const SESSION_COOKIE_NAME = "session";
