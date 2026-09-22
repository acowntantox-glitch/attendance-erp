import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/config/env";
import { ServiceUnavailableError } from "@/lib/errors";
import { getS3Client, isStorageConfigured } from "./client";

export class StorageNotConfiguredError extends ServiceUnavailableError {
  constructor() {
    super("Document storage isn't configured yet. Ask an administrator to set the S3_* environment variables.");
  }
}

function requireClient() {
  const client = getS3Client();
  if (!client || !isStorageConfigured()) throw new StorageNotConfiguredError();
  return client;
}

export function buildDocumentKey(companyId: string, employeeId: string, documentId: string, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `companies/${companyId}/employees/${employeeId}/documents/${documentId}-${safeName}`;
}

/** Presigned PUT URL — the browser uploads bytes directly to S3, not through this server. */
export async function getUploadUrl(key: string, contentType: string, expiresInSeconds = 300): Promise<string> {
  const client = requireClient();
  const command = new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Backs the authorized proxy download route — bytes are streamed through this server (not a
 * presigned URL handed to the browser) so every download re-runs the app's own RBAC/tenant-
 * isolation/self-view checks, matching "never a public URL" / "strictly authorized access" in
 * the Phase 2 spec.
 */
export async function getObjectStream(
  key: string,
): Promise<{ body: ReadableStream; contentType: string; contentLength: number }> {
  const client = requireClient();
  const result = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  if (!result.Body) throw new StorageNotConfiguredError();
  return {
    body: result.Body.transformToWebStream(),
    contentType: result.ContentType ?? "application/octet-stream",
    contentLength: result.ContentLength ?? 0,
  };
}

export async function deleteObject(key: string): Promise<void> {
  const client = requireClient();
  await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}
