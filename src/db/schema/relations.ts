import { relations } from "drizzle-orm";
import { branches, companies, departments, locations } from "./organization";
import { companyMemberships, sessions, users } from "./auth";
import { auditLogs } from "./audit";

export const companiesRelations = relations(companies, ({ many }) => ({
  branches: many(branches),
  departments: many(departments),
  locations: many(locations),
  memberships: many(companyMemberships),
}));

export const branchesRelations = relations(branches, ({ one, many }) => ({
  company: one(companies, { fields: [branches.companyId], references: [companies.id] }),
  locations: many(locations),
}));

export const departmentsRelations = relations(departments, ({ one }) => ({
  company: one(companies, { fields: [departments.companyId], references: [companies.id] }),
}));

export const locationsRelations = relations(locations, ({ one }) => ({
  company: one(companies, { fields: [locations.companyId], references: [companies.id] }),
  branch: one(branches, { fields: [locations.branchId], references: [branches.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(companyMemberships),
  sessions: many(sessions),
}));

export const companyMembershipsRelations = relations(companyMemberships, ({ one }) => ({
  user: one(users, { fields: [companyMemberships.userId], references: [users.id] }),
  company: one(companies, { fields: [companyMemberships.companyId], references: [companies.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  company: one(companies, { fields: [sessions.companyId], references: [companies.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  company: one(companies, { fields: [auditLogs.companyId], references: [companies.id] }),
  actor: one(users, { fields: [auditLogs.actorUserId], references: [users.id] }),
}));
