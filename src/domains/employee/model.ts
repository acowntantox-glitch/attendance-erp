import type {
  documentTypeEnum,
  employeeDocuments,
  employeeHistory,
  employeeHistoryEventEnum,
  employeeNumberCounters,
  employeeOnboarding,
  employeeOnboardingTasks,
  employees,
  employmentStatusEnum,
  employmentTypeEnum,
} from "@/db/schema";

export type Employee = typeof employees.$inferSelect;
/** Employee joined with the display fields the directory/profile need — one query, not N+1. */
export type EmployeeWithRelations = Employee & {
  department: { id: string; name: string } | null;
  designation: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  manager: { id: string; firstName: string; lastName: string } | null;
};
export type EmployeeNumberCounter = typeof employeeNumberCounters.$inferSelect;
export type EmploymentStatus = (typeof employmentStatusEnum.enumValues)[number];
export type EmploymentType = (typeof employmentTypeEnum.enumValues)[number];
export type EmployeeHistoryEntry = typeof employeeHistory.$inferSelect;
export type EmployeeHistoryEventType = (typeof employeeHistoryEventEnum.enumValues)[number];
export type EmployeeOnboarding = typeof employeeOnboarding.$inferSelect;
export type EmployeeOnboardingTask = typeof employeeOnboardingTasks.$inferSelect;
export type EmployeeOnboardingWithTasks = EmployeeOnboarding & { tasks: EmployeeOnboardingTask[] };

export const DEFAULT_ONBOARDING_TASKS = [
  "Employee information completed",
  "Documents uploaded",
  "Account created",
  "Department assigned",
  "Manager assigned",
  "Welcome process completed",
] as const;

/**
 * `userId` links to an EXISTING user account only — this service never creates a login account
 * on an employee's behalf (see docs/architecture, and the Phase 2 execution rules). Most
 * employee records will have no linked account at all.
 */
export type CreateEmployeeInput = {
  firstName: string;
  middleName?: string;
  lastName: string;
  preferredName?: string;
  dateOfBirth?: string;
  gender?: string;
  nationality?: string;
  personalEmail?: string;
  workEmail: string;
  phone?: string;
  alternatePhone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  departmentId?: string;
  designationId?: string;
  locationId?: string;
  managerId?: string;
  employmentType?: EmploymentType;
  dateOfJoining: string;
  probationEndDate?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
  userId?: string;
};

/**
 * `employeeNumber`, `companyId`, and `userId` are intentionally not editable here (spec's
 * "stricter controls" fields). `employmentStatus` changes go through `changeEmployeeStatus`
 * (a separate permission, `employee.manage_status`), not this general update.
 * Every field below is `| null` (undefined = leave unchanged, null = clear) except the ones
 * that can never be blank (`firstName`/`lastName`/`workEmail`/`employmentType`/`dateOfJoining`)
 * — the edit form always submits the full record, so a field the user blanked out must be
 * distinguishable from one it never touched.
 */
export type UpdateEmployeeInput = {
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  nationality?: string | null;
  personalEmail?: string | null;
  workEmail?: string;
  phone?: string | null;
  alternatePhone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  departmentId?: string | null;
  designationId?: string | null;
  locationId?: string | null;
  managerId?: string | null;
  employmentType?: EmploymentType;
  dateOfJoining?: string;
  probationEndDate?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelationship?: string | null;
};

export type EmployeeListFilters = {
  page: number;
  pageSize: number;
  search?: string;
  departmentId?: string;
  designationId?: string;
  locationId?: string;
  status?: EmploymentStatus;
  employmentType?: EmploymentType;
  joinedFrom?: string;
  joinedTo?: string;
  sort?: "name_asc" | "name_desc" | "joined_asc" | "joined_desc" | "employee_number_asc";
};

export type EmployeeListResult = {
  items: EmployeeWithRelations[];
  total: number;
  page: number;
  pageSize: number;
};

/** One org chart level — a node plus enough info to render it and decide whether it's expandable. */
export type OrgChartNode = {
  id: string;
  firstName: string;
  lastName: string;
  photoStorageKey: string | null;
  designationName: string | null;
  departmentName: string | null;
  directReportCount: number;
};

export type EmployeeDocument = typeof employeeDocuments.$inferSelect;
export type DocumentType = (typeof documentTypeEnum.enumValues)[number];
export type DocumentExpiryStatus = "EXPIRED" | "EXPIRING_SOON" | "VALID" | "NO_EXPIRY";

/** Metadata only — never includes `storageKey`. Only the authorized proxy download route
 *  resolves a key to bytes; list/detail responses must not hand it to the client. */
export type EmployeeDocumentSummary = Omit<EmployeeDocument, "storageKey"> & {
  expiryStatus: DocumentExpiryStatus;
};

export type CreateEmployeeDocumentInput = {
  documentType: DocumentType;
  title: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  issueDate?: string;
  expiryDate?: string;
};

export const DEFAULT_EXPIRY_WARNING_DAYS = 30;
