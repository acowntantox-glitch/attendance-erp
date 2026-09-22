import pino from "pino";
import { env, isProduction } from "@/config/env";

export const logger = pino({
  level: isProduction ? "info" : "debug",
  redact: {
    paths: [
      "password",
      "passwordHash",
      "*.password",
      "*.passwordHash",
      "sessionToken",
      "*.sessionToken",
      "cookie",
      "*.cookie",
      "authorization",
      "*.authorization",
      "biometricTemplate",
      "*.biometricTemplate",
    ],
    censor: "[REDACTED]",
  },
  transport:
    env.NODE_ENV === "development" ? { target: "pino-pretty", options: { colorize: true } } : undefined,
});

export type LogContext = {
  requestId?: string;
  userId?: string;
  companyId?: string;
  jobId?: string;
};

export function withContext(context: LogContext) {
  return logger.child(context);
}
