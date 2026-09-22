import { describe, expect, it } from "vitest";
import { buildDocumentKey } from "../index";

// No real bucket exists yet (S3_* env vars are unset in this environment — see .env.test), so
// these tests exercise the parts of the module that don't need one: pure key construction, and
// confirming every S3-touching function fails closed with a clear typed error rather than a raw
// SDK exception when storage isn't configured. Real-bucket integration tests (actual upload/
// download round trips) are deferred until credentials are provided, per the Phase 2 plan.
describe("storage: buildDocumentKey", () => {
  it("builds a namespaced, collision-resistant key", () => {
    const key = buildDocumentKey("company-1", "employee-1", "doc-1", "passport.pdf");
    expect(key).toBe("companies/company-1/employees/employee-1/documents/doc-1-passport.pdf");
  });

  it("sanitizes unsafe filename characters", () => {
    const key = buildDocumentKey("c1", "e1", "d1", "my résumé (final)!!.pdf");
    expect(key).not.toMatch(/[()!]/);
    expect(key).toMatch(/^companies\/c1\/employees\/e1\/documents\/d1-/);
  });
});

describe("storage: fails closed when unconfigured", () => {
  it("rejects getUploadUrl with StorageNotConfiguredError", async () => {
    const { getUploadUrl, StorageNotConfiguredError } = await import("../index");
    await expect(getUploadUrl("some/key", "application/pdf")).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });

  it("rejects getObjectStream with StorageNotConfiguredError", async () => {
    const { getObjectStream, StorageNotConfiguredError } = await import("../index");
    await expect(getObjectStream("some/key")).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });

  it("rejects deleteObject with StorageNotConfiguredError", async () => {
    const { deleteObject, StorageNotConfiguredError } = await import("../index");
    await expect(deleteObject("some/key")).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });

  it("isStorageConfigured() reports false", async () => {
    const { isStorageConfigured } = await import("../client");
    expect(isStorageConfigured()).toBe(false);
  });
});
