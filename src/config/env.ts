import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  APP_URL: z.url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Optional — document storage isn't provisioned yet. `src/lib/storage` throws a clear
  // StorageNotConfiguredError at call-time if these are unset, rather than failing app boot, so
  // the rest of Phase 2 stays buildable/testable without a real bucket.
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),

  // Batch 13 — scheduled attendance processing. The job endpoint is disabled (rejects every
  // request) until INTERNAL_JOB_SECRET is set.
  INTERNAL_JOB_SECRET: z.string().min(32, "INTERNAL_JOB_SECRET must be at least 32 characters").optional(),
  // A work date becomes eligible this long after it has ended in the latest-ending timezone/shift.
  ATTENDANCE_PROCESSING_LAG_MINUTES: z.coerce.number().int().min(0).max(1440).default(180),
  // How many of the most recent eligible work dates each run examines (catches missed invocations).
  ATTENDANCE_PROCESSING_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(31).default(7),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
