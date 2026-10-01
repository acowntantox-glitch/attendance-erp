import { describe, expect, it } from "vitest";
import { ALLOWED_DOCUMENT_TYPES, createEmployeeDocumentSchema, isAllowedDocumentType } from "./employee";

const base = { documentType: "PASSPORT", title: "Passport", originalFilename: "passport.pdf", mimeType: "application/pdf", sizeBytes: 1024 };
const ok = (overrides: Record<string, unknown>) => createEmployeeDocumentSchema.safeParse({ ...base, ...overrides }).success;

describe("employee document upload validation (server side)", () => {
  it("accepts the document formats HR actually uploads, with a matching extension", () => {
    expect(ok({})).toBe(true);
    expect(ok({ originalFilename: "scan.JPG", mimeType: "image/jpeg" })).toBe(true);
    expect(ok({ originalFilename: "id.png", mimeType: "image/png" })).toBe(true);
    expect(ok({ originalFilename: "contract.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe(true);
    expect(ok({ originalFilename: "old.doc", mimeType: "application/msword" })).toBe(true);
  });

  it("refuses types that can carry script or executable content, whatever the client claims", () => {
    for (const [mimeType, originalFilename] of [
      ["text/html", "page.html"],
      ["image/svg+xml", "logo.svg"],
      ["application/javascript", "run.js"],
      ["application/x-msdownload", "setup.exe"],
      ["application/octet-stream", "blob.pdf"], // the browser's fallback for an unknown type
      ["application/zip", "files.zip"],
    ]) {
      expect(ok({ mimeType, originalFilename })).toBe(false);
    }
    expect(isAllowedDocumentType("text/html")).toBe(false);
    expect(Object.keys(ALLOWED_DOCUMENT_TYPES)).toHaveLength(5);
  });

  it("does not let the declared type and the file name disagree (an .html file declared as a PDF)", () => {
    expect(ok({ originalFilename: "payload.html", mimeType: "application/pdf" })).toBe(false);
    expect(ok({ originalFilename: "noextension", mimeType: "application/pdf" })).toBe(false);
    expect(ok({ originalFilename: "photo.png", mimeType: "image/jpeg" })).toBe(false);
  });

  it("refuses path separators and control characters in the file name", () => {
    for (const originalFilename of ["../../etc/passwd.pdf", "a/b.pdf", "a\b.pdf", "bad\r\nname.pdf", "nul\u0000.pdf"]) {
      expect(ok({ originalFilename })).toBe(false);
    }
  });

  it("enforces the size cap and a positive integer size", () => {
    expect(ok({ sizeBytes: 25 * 1024 * 1024 })).toBe(true);
    expect(ok({ sizeBytes: 25 * 1024 * 1024 + 1 })).toBe(false);
    expect(ok({ sizeBytes: 0 })).toBe(false);
    expect(ok({ sizeBytes: 1.5 })).toBe(false);
  });
});
