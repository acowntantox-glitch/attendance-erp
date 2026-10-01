import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";

const available = await isDatabaseAvailable();

// The F-03 route test cold-imports two route modules (and their dependency graph) on top of real-Postgres
// round trips - same class of timing as the attendance integration suites that widen this.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

// The route handlers resolve the caller via getRequestContext(); everything else in request-context
// (requirePermission, assertCompanyAccess) stays real so the services authorize exactly as in production.
const reqCtx = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/request-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/request-context")>()),
  getRequestContext: async () => reqCtx.current,
}));
// No real bucket exists: getObjectStream passes through (fails closed, StorageNotConfiguredError) unless a test stubs it.
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return { ...actual, getObjectStream: vi.fn(actual.getObjectStream) };
});

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

  // ---------------------------------------------------------------------------------------------
  // F-03 - non-self document access needs employee.view_documents (HR-only). MANAGER holds
  // employee.view but is deliberately denied until team scoping exists (F-02).
  // ---------------------------------------------------------------------------------------------
  describe("F-03 document authorization", () => {
    let storageModule: typeof import("@/lib/storage");
    let hrAdminCtx: import("@/lib/auth/request-context").RequestContext;
    let hrManagerCtx: import("@/lib/auth/request-context").RequestContext;
    let subjectDocumentId: string;
    let selfDocumentId: string;

    const fakeStream = () => ({ body: new ReadableStream(), contentType: "application/pdf", contentLength: 1 });

    async function newDocument(forEmployeeId: string, title: string) {
      const doc = await repository.employeeDocumentRepository.create({
        companyId,
        employeeId: forEmployeeId,
        documentType: "PASSPORT",
        title,
        storageKey: `test/f03/${title}`,
        originalFilename: `${title}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 100,
      });
      return doc.id;
    }

    beforeAll(async () => {
      storageModule = await import("@/lib/storage");
      hrAdminCtx = { ...adminCtx, requestId: "doc-test-hr-admin", role: "HR_ADMIN" };
      hrManagerCtx = { ...adminCtx, requestId: "doc-test-hr-manager", role: "HR_MANAGER" };
      subjectDocumentId = await newDocument(employeeId, "f03-subject");
      selfDocumentId = await newDocument(selfEmployeeId, "f03-self");
    });

    it("a MANAGER cannot list another employee's documents", async () => {
      await expect(service.listEmployeeDocuments(managerCtx, employeeId)).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("a MANAGER cannot download, and storage is never touched", async () => {
      const spy = vi.mocked(storageModule.getObjectStream);
      spy.mockClear();
      await expect(service.getEmployeeDocumentDownload(managerCtx, employeeId, subjectDocumentId)).rejects.toBeInstanceOf(AuthorizationError);
      expect(spy).not.toHaveBeenCalled();
    });

    it("a MANAGER cannot upload or archive", async () => {
      await expect(
        service.initiateEmployeeDocumentUpload(managerCtx, employeeId, { documentType: "OTHER", title: "x", originalFilename: "x.pdf", mimeType: "application/pdf", sizeBytes: 10 }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(service.archiveEmployeeDocument(managerCtx, employeeId, subjectDocumentId)).rejects.toBeInstanceOf(AuthorizationError);
    });

    it.each([
      ["HR_ADMIN", () => hrAdminCtx],
      ["HR_MANAGER", () => hrManagerCtx],
    ])("%s can list and download", async (_role, getCtx) => {
      const hrCtx = getCtx();
      const listed = await service.listEmployeeDocuments(hrCtx, employeeId);
      expect(listed.some((d) => d.id === subjectDocumentId)).toBe(true);

      vi.mocked(storageModule.getObjectStream).mockResolvedValueOnce(fakeStream());
      const download = await service.getEmployeeDocumentDownload(hrCtx, employeeId, subjectDocumentId);
      expect(download.filename).toBe("f03-subject.pdf");
    });

    it("an employee can list and download their own documents, but cannot upload or archive", async () => {
      const listed = await service.listEmployeeDocuments(selfCtx, selfEmployeeId);
      expect(listed.some((d) => d.id === selfDocumentId)).toBe(true);

      vi.mocked(storageModule.getObjectStream).mockResolvedValueOnce(fakeStream());
      const download = await service.getEmployeeDocumentDownload(selfCtx, selfEmployeeId, selfDocumentId);
      expect(download.filename).toBe("f03-self.pdf");

      await expect(
        service.initiateEmployeeDocumentUpload(selfCtx, selfEmployeeId, { documentType: "OTHER", title: "x", originalFilename: "x.pdf", mimeType: "application/pdf", sizeBytes: 10 }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(service.archiveEmployeeDocument(selfCtx, selfEmployeeId, selfDocumentId)).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("company isolation is unchanged: another company's HR_ADMIN cannot list or download", async () => {
      const [otherCompany] = await db.insert(schema.companies).values({ name: "F03 Other Co", code: `DOC_F03_${Date.now()}` }).returning();
      try {
        const otherHr = { ...hrAdminCtx, companyId: otherCompany!.id, requestId: "doc-test-other-hr" };
        await expect(service.listEmployeeDocuments(otherHr, employeeId)).rejects.toBeInstanceOf(AuthorizationError);
        await expect(service.getEmployeeDocumentDownload(otherHr, employeeId, subjectDocumentId)).rejects.toBeInstanceOf(AuthorizationError);
      } finally {
        await db.delete(schema.companies).where(eq(schema.companies.id, otherCompany!.id));
      }
    });

    it("a download is still audited as employee.document_download (actor, entity), and a denied one is not", async () => {
      vi.mocked(storageModule.getObjectStream).mockResolvedValueOnce(fakeStream());
      await service.getEmployeeDocumentDownload(hrAdminCtx, employeeId, subjectDocumentId);
      const logs = await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.entityId, subjectDocumentId) });
      const downloads = logs.filter((l) => l.action === "employee.document_download");
      expect(downloads.length).toBeGreaterThanOrEqual(1);
      expect(downloads.every((l) => l.actorUserId === adminUserId && l.companyId === companyId)).toBe(true);

      const before = downloads.length;
      await expect(service.getEmployeeDocumentDownload(managerCtx, employeeId, subjectDocumentId)).rejects.toBeInstanceOf(AuthorizationError);
      const after = (await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.entityId, subjectDocumentId) })).filter(
        (l) => l.action === "employee.document_download",
      ).length;
      expect(after).toBe(before);
    });

    it("the API routes answer a MANAGER with the standard 403 envelope (list and download)", async () => {
      const listRoute = await import("@/app/api/employees/[id]/documents/route");
      const downloadRoute = await import("@/app/api/employees/[id]/documents/[documentId]/download/route");
      reqCtx.current = managerCtx;
      try {
        const listResponse = await listRoute.GET(new Request("http://localhost/api/x"), { params: Promise.resolve({ id: employeeId }) });
        expect(listResponse.status).toBe(403);
        expect((await listResponse.json()).error.code).toBe("FORBIDDEN");

        const downloadResponse = await downloadRoute.GET(new Request("http://localhost/api/x"), {
          params: Promise.resolve({ id: employeeId, documentId: subjectDocumentId }),
        });
        expect(downloadResponse.status).toBe(403);
        expect((await downloadResponse.json()).error.code).toBe("FORBIDDEN");

        // ...and an HR caller through the very same route is allowed.
        reqCtx.current = hrAdminCtx;
        const hrResponse = await listRoute.GET(new Request("http://localhost/api/x"), { params: Promise.resolve({ id: employeeId }) });
        expect(hrResponse.status).toBe(200);
      } finally {
        reqCtx.current = null;
      }
    });
  });
});
