import {
  type AnyPgColumn,
  boolean,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
// Deferred reference (departments -> employees), completing a two-table cycle with
// employee.ts (employees.department_id -> departments.id). The explicit `AnyPgColumn` return
// type on the callback below is required — without it, TS can't resolve the mutual type
// inference between the two files and both schema modules degrade to `any`.
import { employees } from "./employee";

export const companyStatusEnum = pgEnum("company_status", ["active", "inactive", "suspended"]);

export const companies = pgTable("companies", {
  id: id(),
  name: text().notNull(),
  legalName: text("legal_name"),
  code: text().notNull().unique(),
  status: companyStatusEnum().notNull().default("active"),
  timezone: text().notNull().default("Asia/Dubai"),
  ...timestamps,
});

export const branches = pgTable(
  "branches",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text().notNull(),
    code: text().notNull(),
    address: text(),
    city: text(),
    state: text(),
    country: text(),
    postalCode: text("postal_code"),
    timezone: text(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [unique("branches_company_code_unique").on(table.companyId, table.code)],
);

export const departments = pgTable(
  "departments",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text().notNull(),
    code: text().notNull(),
    description: text(),
    // Nullable self-reference: a top-level department has no parent. Circular-hierarchy
    // prevention is enforced in the service layer (see domains/organization/service.ts),
    // not the database, since Postgres can't express "no cycles" as a constraint.
    parentDepartmentId: uuid("parent_department_id"),
    departmentHeadId: uuid("department_head_id").references((): AnyPgColumn => employees.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("departments_company_code_unique").on(table.companyId, table.code),
    foreignKey({
      columns: [table.parentDepartmentId],
      foreignColumns: [table.id],
      name: "departments_parent_department_id_fk",
    }).onDelete("set null"),
    index("departments_parent_department_id_idx").on(table.parentDepartmentId),
    index("departments_department_head_id_idx").on(table.departmentHeadId),
  ],
);

export const locations = pgTable(
  "locations",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    name: text().notNull(),
    address: text(),
    latitude: numeric({ precision: 9, scale: 6 }).notNull(),
    longitude: numeric({ precision: 9, scale: 6 }).notNull(),
    timezone: text(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  // No unique(company_id, code) exists on this table (unlike branches/departments) to piggyback
  // on for company-scoped lookups, so listByCompany(companyId) needs an explicit index.
  (table) => [index("locations_company_id_idx").on(table.companyId), index("locations_branch_id_idx").on(table.branchId)],
);

export const designations = pgTable(
  "designations",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text().notNull(),
    code: text().notNull(),
    description: text(),
    // Seniority ranking (e.g. 1 = Intern, 5 = Manager) — optional, used for sorting/reporting.
    level: integer(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [unique("designations_company_code_unique").on(table.companyId, table.code)],
);
