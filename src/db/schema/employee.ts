import {
  type AnyPgColumn,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { branches, companies, departments, designations } from "./organization";
import { users } from "./auth";

export const employmentStatusEnum = pgEnum("employment_status", [
  "ACTIVE",
  "PROBATION",
  "ON_LEAVE",
  "NOTICE_PERIOD",
  "SUSPENDED",
  "RESIGNED",
  "TERMINATED",
  "INACTIVE",
]);

export const employmentTypeEnum = pgEnum("employment_type", [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "INTERN",
  "TEMPORARY",
  "FREELANCE",
]);

export const onboardingStatusEnum = pgEnum("onboarding_status", [
  "DRAFT",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);

export const employeeHistoryEventEnum = pgEnum("employee_history_event", [
  "CREATED",
  "DEPARTMENT_CHANGED",
  "DESIGNATION_CHANGED",
  "MANAGER_CHANGED",
  "LOCATION_CHANGED",
  "EMPLOYMENT_TYPE_CHANGED",
  "STATUS_CHANGED",
  "PROMOTION",
  "TRANSFER",
  "RESIGNED",
  "TERMINATED",
  "ARCHIVED",
]);

export const documentTypeEnum = pgEnum("document_type", [
  "EMPLOYMENT_CONTRACT",
  "PASSPORT",
  "EMIRATES_ID",
  "VISA",
  "CERTIFICATE",
  "OFFER_LETTER",
  "OTHER",
]);

/**
 * One row per company. `nextNumber` is incremented atomically via
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` (see employeeNumberCounterRepository) — a
 * single atomic statement, so concurrent employee creations never collide without needing
 * SELECT ... FOR UPDATE or advisory locks.
 */
export const employeeNumberCounters = pgTable("employee_number_counters", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  nextNumber: integer("next_number").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employees = pgTable(
  "employees",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // Optional link to a login account — an employee record can exist (HR onboarding) before
    // any account is created for them. Never created automatically; see domains/employee/service.ts.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    employeeNumber: text("employee_number").notNull(),

    // Identity
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    preferredName: text("preferred_name"),
    photoStorageKey: text("photo_storage_key"),
    dateOfBirth: date("date_of_birth"),
    gender: text(),
    nationality: text(),

    // Contact
    personalEmail: text("personal_email"),
    workEmail: text("work_email").notNull(),
    phone: text(),
    alternatePhone: text("alternate_phone"),
    address: text(),
    city: text(),
    state: text(),
    country: text(),
    postalCode: text("postal_code"),

    // Employment
    departmentId: uuid("department_id").references((): AnyPgColumn => departments.id, { onDelete: "set null" }),
    designationId: uuid("designation_id").references(() => designations.id, { onDelete: "set null" }),
    // "Location" per the Phase 2 spec maps to the existing `branches` table, not the separate
    // GPS-geofence `locations` table (which is reserved for future attendance verification).
    locationId: uuid("location_id").references(() => branches.id, { onDelete: "set null" }),
    managerId: uuid("manager_id"),
    employmentType: employmentTypeEnum("employment_type").notNull().default("FULL_TIME"),
    employmentStatus: employmentStatusEnum("employment_status").notNull().default("ACTIVE"),
    dateOfJoining: date("date_of_joining").notNull(),
    probationEndDate: date("probation_end_date"),
    confirmationDate: date("confirmation_date"),
    dateOfExit: date("date_of_exit"),

    // Additional
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    emergencyContactRelationship: text("emergency_contact_relationship"),

    // System
    onboardingStatus: onboardingStatusEnum("onboarding_status").notNull().default("DRAFT"),
    isArchived: boolean("is_archived").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    unique("employees_company_employee_number_unique").on(table.companyId, table.employeeNumber),
    // Work email uniqueness is scoped per company (not global), matching every other
    // uniqueness rule in this schema (branch/department/designation codes) — resolved with the
    // user during Phase 2 planning.
    unique("employees_company_work_email_unique").on(table.companyId, table.workEmail),
    unique("employees_user_id_unique").on(table.userId),
    foreignKey({
      columns: [table.managerId],
      foreignColumns: [table.id],
      name: "employees_manager_id_fk",
    }).onDelete("set null"),
    index("employees_company_id_idx").on(table.companyId),
    index("employees_department_id_idx").on(table.departmentId),
    index("employees_designation_id_idx").on(table.designationId),
    index("employees_location_id_idx").on(table.locationId),
    index("employees_manager_id_idx").on(table.managerId),
    index("employees_status_idx").on(table.companyId, table.employmentStatus),
    index("employees_date_of_joining_idx").on(table.companyId, table.dateOfJoining),
  ],
);

/**
 * Structured lifecycle events — deliberately separate from `audit_logs` (technical/system
 * audit trail) so HR-facing "what changed and when" queries don't have to filter a generic
 * log. One row per changed field (e.g. an update touching both department and manager writes
 * two rows), not one blob per request.
 */
export const employeeHistory = pgTable(
  "employee_history",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    eventType: employeeHistoryEventEnum("event_type").notNull(),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    effectiveDate: date("effective_date"),
    before: jsonb(),
    after: jsonb(),
    note: text(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index("employee_history_employee_id_idx").on(table.employeeId, table.createdAt),
    index("employee_history_company_id_idx").on(table.companyId),
  ],
);

/**
 * 1:1 with employee. A clean foundation, not a workflow engine — see Phase 2 spec §16.
 * The status enum lives on `employees.onboardingStatus` (single source of truth, already
 * indexed alongside the rest of the employee record) — this table only holds the
 * started/completed timestamps and is the parent for the task checklist.
 */
export const employeeOnboarding = pgTable(
  "employee_onboarding",
  {
    id: id(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [unique("employee_onboarding_employee_id_unique").on(table.employeeId)],
);

export const employeeOnboardingTasks = pgTable(
  "employee_onboarding_tasks",
  {
    id: id(),
    onboardingId: uuid("onboarding_id")
      .notNull()
      .references(() => employeeOnboarding.id, { onDelete: "cascade" }),
    label: text().notNull(),
    isCompleted: boolean("is_completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("employee_onboarding_tasks_onboarding_id_idx").on(table.onboardingId)],
);

/**
 * `storageKey` is an S3 object key, never a public URL — access is only ever granted through
 * the authorized proxy download route (see src/lib/storage and the documents API routes), which
 * re-runs the same RBAC/tenant-isolation/self-view checks as every other resource. List
 * responses never include `storageKey` for the same reason.
 */
export const employeeDocuments = pgTable(
  "employee_documents",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    documentType: documentTypeEnum("document_type").notNull(),
    title: text().notNull(),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    issueDate: date("issue_date"),
    expiryDate: date("expiry_date"),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    isArchived: boolean("is_archived").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("employee_documents_employee_id_idx").on(table.employeeId),
    index("employee_documents_company_id_idx").on(table.companyId),
    index("employee_documents_expiry_date_idx").on(table.companyId, table.expiryDate),
  ],
);
