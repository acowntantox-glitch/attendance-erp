import { boolean, index, numeric, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";

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
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [unique("departments_company_code_unique").on(table.companyId, table.code)],
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
