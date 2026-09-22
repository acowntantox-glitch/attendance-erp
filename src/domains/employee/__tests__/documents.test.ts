import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";

const available = await isDatabaseAvailable();

/**
 * No real S3 bucket exists yet (see src/lib/storage), so `initiateEmployeeDocumentUpload` and
 * `getEmployeeDocumentDownload` can't be exercised end-to-end here — both call into storage
 * only *after* their authorization checks pass, so this suite instead: (a) proves the
 * authorization checks reject before ever touching storage, by asserting the rejection is the
 * expected auth error and not a storage error, and (b) tests everything storage-independent
 * (list, archive, expiry-status computation) against documents inserted directly via the
 * repository, standing in for a completed upload.
 */
describe.skipIf(!available)("employee documents", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let service: typeof import("../service");
  let repository: typeof import("../repository");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;
  let StorageNotConfiguredError: typeof import("@/lib/storage").StorageNotConfiguredError;

  let companyId: string;
  let adminUserId: string;
  let selfUserId: string;
  let employeeId: string;
  let selfEmployeeId: string;
  let adminCtx: import("@/lib/auth/request-context").RequestContext;
  let selfCtx: import("@/lib/auth/request-context").RequestContext;
  let managerCtx: import("@/lib/auth/request-context").RequestContext;

  function daysFromNowIso(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    service = await import("../service");
    repository = await import("../repository");
    ({ AuthorizationError } = await import("@/lib/errors"));
    ({ StorageNotConfiguredError } = await import("@/lib/storage"));

    const [company] = await db
      .insert(schema.companies)
      .values({ name: "Documents Test Co", code: `DOC_TEST_${Date.now()}` })
      .returning();
    companyId = company!.id;

    const [adminUser] = await db
      .insert(schema.users)
      .values({ email: `admin-${Date.now()}@doc-test.local`, passwordHash: "unused", fullName: "Doc Test Admin" })
      .returning();
    adminUserId = adminUser!.id;

    const [selfUser] = await db
      .insert(schema.users)
      .values({ email: `self-${Date.now()}@doc-test.local`, passwordHash: "unused", fullName: "Doc Test Self" })
      .returning();
    selfUserId = selfUser!.id;

    adminCtx = {
      requestId: "doc-test-admin",
      userId: adminUserId,
      userEmail: adminUser!.email,
      companyId,
      role: "COMPANY_ADMIN",
      employeeId: null,
    };
    managerCtx = { ...adminCtx, requestId: "doc-test-manager", role: "MANAGER" };

    const employee = await service.createEmployee(adminCtx, {
      firstName: "Doc",
      lastName: "Subject",
      workEmail: `doc-subject-${Date.now()}@doc-test.local`,
      dateOfJoining: "2026-01-01",
    });
    employeeId = employee.id;

    const selfEmployee = await service.createEmployee(adminCtx, {
      firstName: "Doc",
      lastName: "SelfSubject",
      workEmail: `doc-self-${Date.now()}@doc-test.local`,
      dateOfJoining: "2026-01-01",
    });
    selfEmployeeId = selfEmployee.id;
    await db.update(schema.employees).set({ userId: selfUserId }).where(eq(schema.employees.id, selfEmployeeId));
    selfCtx = {
      requestId: "doc-test-self",
      userId: selfUserId,
      userEmail: selfUser!.email,
      companyId,
      role: "EMPLOYEE",
      employeeId: selfEmployeeId,
    };
  });

  afterAll(async () => {
    await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
    await db.delete(schema.users).where(eq(schema.users.id, adminUserId));
    await db.delete(schema.users).where(eq(schema.users.id, selfUserId));
    await pool.end();
  });

  it("lists documents with computed expiry status for all four states", async () => {
    await repository.employeeDocumentRepository.create({
      companyId,
      employeeId,
      documentType: "PASSPORT",
      title: "Expired doc",
      storageKey: "test/expired",
      originalFilename: "expired.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      expiryDate: daysFromNowIso(-5),
    });
    await repository.employeeDocumentRepository.create({
      companyId,
      employeeId,
      documentType: "VISA",
      title: "Expiring soon doc",
      storageKey: "test/expiring-soon",
      originalFilename: "visa.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      expiryDate: daysFromNowIso(10),
    });
    await repository.employeeDocumentRepository.create({
      companyId,
      employeeId,
      documentType: "CERTIFICATE",
      title: "Valid doc",
      storageKey: "test/valid",
      originalFilename: "cert.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      expiryDate: daysFromNowIso(365),
    });
    await repository.employeeDocumentRepository.create({
      companyId,
      employeeId,
      documentType: "OTHER",
      title: "No expiry doc",
      storageKey: "test/no-expiry",
      originalFilename: "other.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
    });

    const documents = await service.listEmployeeDocuments(adminCtx, employeeId);
    const byTitle = Object.fromEntries(documents.map((d) => [d.title, d.expiryStatus]));
    expect(byTitle["Expired doc"]).toBe("EXPIRED");
    expect(byTitle["Expiring soon doc"]).toBe("EXPIRING_SOON");
    expect(byTitle["Valid doc"]).toBe("VALID");
    expect(byTitle["No expiry doc"]).toBe("NO_EXPIRY");

    // Metadata only — the S3 object key must never reach the API/UI layer.
    expect(documents.every((d) => !("storageKey" in d))).toBe(true);
  });

  it("archives a document (soft-delete, not a hard delete)", async () => {
    const document = await repository.employeeDocumentRepository.create({
      companyId,
      employeeId,
      documentType: "OFFER_LETTER",
      title: "To archive",
      storageKey: "test/to-archive",
      originalFilename: "offer.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
    });

    const archived = await service.archiveEmployeeDocument(adminCtx, employeeId, document.id);
    expect(archived.isArchived).toBe(true);

    const remaining = await service.listEmployeeDocuments(adminCtx, employeeId);
    expect(remaining.find((d) => d.id === document.id)).toBeUndefined();

    const stillInDb = await repository.employeeDocumentRepository.findById(document.id);
    expect(stillInDb).toBeDefined();
  });

  it("allows an employee to list their own documents without employee.view", async () => {
    await expect(service.listEmployeeDocuments(selfCtx, selfEmployeeId)).resolves.toBeDefined();
  });

  it("rejects an employee listing another employee's documents", async () => {
    await expect(service.listEmployeeDocuments(selfCtx, employeeId)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects initiating an upload without employee.manage_documents (auth check runs before storage)", async () => {
    await expect(
      service.initiateEmployeeDocumentUpload(managerCtx, employeeId, {
        documentType: "OTHER",
        title: "Should fail",
        originalFilename: "x.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("reaches storage (and fails closed) once authorization passes, proving the auth-then-storage ordering", async () => {
    await expect(
      service.initiateEmployeeDocumentUpload(adminCtx, employeeId, {
        documentType: "OTHER",
        title: "Would succeed with a real bucket",
        originalFilename: "x.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });

  it("rejects a download for a document outside the caller's company (before touching storage)", async () => {
    const [otherCompany] = await db
      .insert(schema.companies)
      .values({ name: "Other Doc Co", code: `DOC_OTHER_${Date.now()}` })
      .returning();
    const otherCtx: import("@/lib/auth/request-context").RequestContext = {
      requestId: "other-doc-co",
      userId: adminUserId,
      userEmail: "admin@doc-test.local",
      companyId: otherCompany!.id,
      role: "COMPANY_ADMIN",
      employeeId: null,
    };

    await expect(service.getEmployeeDocumentDownload(otherCtx, employeeId, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(
      AuthorizationError,
    );

    await db.delete(schema.companies).where(eq(schema.companies.id, otherCompany!.id));
  });
});
