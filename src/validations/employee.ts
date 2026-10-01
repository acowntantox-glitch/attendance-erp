import { z } from "zod";

const employmentStatusValues = [
  "ACTIVE",
  "PROBATION",
  "ON_LEAVE",
  "NOTICE_PERIOD",
  "SUSPENDED",
  "RESIGNED",
  "TERMINATED",
  "INACTIVE",
] as const;

const employmentTypeValues = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "TEMPORARY", "FREELANCE"] as const;

const documentTypeValues = [
  "EMPLOYMENT_CONTRACT",
  "PASSPORT",
  "EMIRATES_ID",
  "VISA",
  "CERTIFICATE",
  "OFFER_LETTER",
  "OTHER",
] as const;

export const employmentStatusSchema = z.enum(employmentStatusValues);
export const employmentTypeSchema = z.enum(employmentTypeValues);
export const documentTypeSchema = z.enum(documentTypeValues);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)");

export const createEmployeeSchema = z.object({
  firstName: z.string().min(1).max(200),
  middleName: z.string().max(200).optional(),
  lastName: z.string().min(1).max(200),
  preferredName: z.string().max(200).optional(),
  dateOfBirth: isoDate.optional(),
  gender: z.string().max(64).optional(),
  nationality: z.string().max(120).optional(),
  personalEmail: z.email().optional(),
  workEmail: z.email(),
  phone: z.string().max(32).optional(),
  alternatePhone: z.string().max(32).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
  postalCode: z.string().max(32).optional(),
  departmentId: z.uuid().optional(),
  designationId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  managerId: z.uuid().optional(),
  employmentType: employmentTypeSchema.optional(),
  dateOfJoining: isoDate,
  probationEndDate: isoDate.optional(),
  emergencyContactName: z.string().max(200).optional(),
  emergencyContactPhone: z.string().max(32).optional(),
  emergencyContactRelationship: z.string().max(120).optional(),
  userId: z.uuid().optional(),
});

// Every optional field accepts `null` in addition to its normal type: undefined = leave
// unchanged, null = clear the field, a value = set it. The edit form always submits the full
// record, so a field the user blanked out must be distinguishable from a field it never touched.
export const updateEmployeeSchema = z.object({
  firstName: z.string().min(1).max(200).optional(),
  middleName: z.string().max(200).nullable().optional(),
  lastName: z.string().min(1).max(200).optional(),
  preferredName: z.string().max(200).nullable().optional(),
  dateOfBirth: isoDate.nullable().optional(),
  gender: z.string().max(64).nullable().optional(),
  nationality: z.string().max(120).nullable().optional(),
  personalEmail: z.email().nullable().optional(),
  workEmail: z.email().optional(),
  phone: z.string().max(32).nullable().optional(),
  alternatePhone: z.string().max(32).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(120).nullable().optional(),
  country: z.string().max(120).nullable().optional(),
  postalCode: z.string().max(32).nullable().optional(),
  departmentId: z.uuid().nullable().optional(),
  designationId: z.uuid().nullable().optional(),
  locationId: z.uuid().nullable().optional(),
  managerId: z.uuid().nullable().optional(),
  employmentType: employmentTypeSchema.optional(),
  dateOfJoining: isoDate.optional(),
  probationEndDate: isoDate.nullable().optional(),
  emergencyContactName: z.string().max(200).nullable().optional(),
  emergencyContactPhone: z.string().max(32).nullable().optional(),
  emergencyContactRelationship: z.string().max(120).nullable().optional(),
});

export const changeEmployeeStatusSchema = z.object({
  status: employmentStatusSchema,
  note: z.string().max(1000).optional(),
});

export const listEmployeesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(200).optional(),
  departmentId: z.uuid().optional(),
  designationId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  status: employmentStatusSchema.optional(),
  employmentType: employmentTypeSchema.optional(),
  joinedFrom: isoDate.optional(),
  joinedTo: isoDate.optional(),
  sort: z.enum(["name_asc", "name_desc", "joined_asc", "joined_desc", "employee_number_asc"]).optional(),
});

/**
 * Employee documents are scanned copies of contracts, IDs, visas and certificates, so only those formats are
 * accepted, and the file extension must agree with the declared type. The bytes go straight from the browser to
 * the bucket (this server never sees them), so `mimeType`/`sizeBytes` are a client's CLAIMS: the server's job is to
 * refuse anything outside this list and then BIND the upload to what was approved - the presigned URL signs this
 * exact Content-Type and Content-Length, so the bucket rejects a body that differs (see `storage.getUploadUrl`).
 */
export const ALLOWED_DOCUMENT_TYPES: Readonly<Record<string, readonly string[]>> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
};

export function isAllowedDocumentType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_DOCUMENT_TYPES, mimeType);
}

export const createEmployeeDocumentSchema = z
  .object({
    documentType: documentTypeSchema,
    title: z.string().min(1).max(200),
    // No path separators or control characters (it ends up in a storage key and a download header).
    originalFilename: z
      .string()
      .min(1)
      .max(255)
      .refine((name) => !/[\\/\x00-\x1f\x7f]/.test(name), "The file name contains characters that are not allowed."),
    mimeType: z.string().min(1).max(120),
    sizeBytes: z.number().int().min(1).max(25 * 1024 * 1024), // 25MB cap
    issueDate: isoDate.optional(),
    expiryDate: isoDate.optional(),
  })
  .superRefine((value, ctx) => {
    if (!isAllowedDocumentType(value.mimeType)) {
      ctx.addIssue({ code: "custom", path: ["mimeType"], message: "This file type is not allowed. Upload a PDF, JPEG, PNG, DOC or DOCX." });
      return;
    }
    const extension = value.originalFilename.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_DOCUMENT_TYPES[value.mimeType]!.includes(extension)) {
      ctx.addIssue({ code: "custom", path: ["originalFilename"], message: "The file extension does not match the file type." });
    }
  });

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type ChangeEmployeeStatusInput = z.infer<typeof changeEmployeeStatusSchema>;
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;
export type CreateEmployeeDocumentInput = z.infer<typeof createEmployeeDocumentSchema>;
