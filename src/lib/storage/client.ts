import { S3Client } from "@aws-sdk/client-s3";
import { env } from "@/config/env";

const globalForStorage = globalThis as unknown as { s3Client?: S3Client };

export function isStorageConfigured(): boolean {
  return Boolean(env.S3_BUCKET && env.S3_REGION && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

/** Returns `null` when S3 isn't configured yet — callers must check `isStorageConfigured()`
 *  first (or use the helpers in `./index`, which do this for you) rather than dereference this
 *  directly. */
export function getS3Client(): S3Client | null {
  if (!isStorageConfigured()) return null;

  if (!globalForStorage.s3Client) {
    globalForStorage.s3Client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      },
    });
  }
  return globalForStorage.s3Client;
}
