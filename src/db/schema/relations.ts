import { relations } from "drizzle-orm";
import { branches, companies, departments, designations, locations } from "./organization";
import { companyMemberships, sessions, users } from "./auth";
import { auditLogs } from "./audit";
import { employeeDocuments, employeeHistory, employeeOnboarding, employeeOnboardingTasks, employees } from "./employee";

export const companiesRelations = relations(companies, ({ many }) => ({
  branches: many(branches),
  departments: many(departments),
  designations: many(designations),
  locations: many(locations),
  memberships: many(companyMemberships),
  employees: many(employees),
}));

export const branchesRelations = relations(branches, ({ one, many }) => ({
  company: one(companies, { fields: [branches.companyId], references: [companies.id] }),
  locations: many(locations),
  employees: many(employees),
}));

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  company: one(companies, { fields: [departments.companyId], references: [companies.id] }),
  parentDepartment: one(departments, {
    fields: [departments.parentDepartmentId],
    references: [departments.id],
    relationName: "department_hierarchy",
  }),
  childDepartments: many(departments, { relationName: "department_hierarchy" }),
  employees: many(employees),
  head: one(employees, {
    fields: [departments.departmentHeadId],
    references: [employees.id],
    relationName: "department_head",
  }),
}));

export const designationsRelations = relations(designations, ({ one, many }) => ({
  company: one(companies, { fields: [designations.companyId], references: [companies.id] }),
  employees: many(employees),
}));

export const locationsRelations = relations(locations, ({ one }) => ({
  company: one(companies, { fields: [locations.companyId], references: [companies.id] }),
  branch: one(branches, { fields: [locations.branchId], references: [branches.id] }),
}));

export const employeesRelations = relations(employees, ({ one, many }) => ({
  company: one(companies, { fields: [employees.companyId], references: [companies.id] }),
  user: one(users, { fields: [employees.userId], references: [users.id] }),
  department: one(departments, { fields: [employees.departmentId], references: [departments.id] }),
  designation: one(designations, { fields: [employees.designationId], references: [designations.id] }),
  location: one(branches, { fields: [employees.locationId], references: [branches.id] }),
  manager: one(employees, {
    fields: [employees.managerId],
    references: [employees.id],
    relationName: "employee_hierarchy",
  }),
  directReports: many(employees, { relationName: "employee_hierarchy" }),
  history: many(employeeHistory),
  onboarding: one(employeeOnboarding, {
    fields: [employees.id],
    references: [employeeOnboarding.employeeId],
  }),
  documents: many(employeeDocuments),
}));

export const employeeDocumentsRelations = relations(employeeDocuments, ({ one }) => ({
  company: one(companies, { fields: [employeeDocuments.companyId], references: [companies.id] }),
  employee: one(employees, { fields: [employeeDocuments.employeeId], references: [employees.id] }),
  uploadedBy: one(users, { fields: [employeeDocuments.uploadedByUserId], references: [users.id] }),
}));

export const employeeHistoryRelations = relations(employeeHistory, ({ one }) => ({
  company: one(companies, { fields: [employeeHistory.companyId], references: [companies.id] }),
  employee: one(employees, { fields: [employeeHistory.employeeId], references: [employees.id] }),
  changedBy: one(users, { fields: [employeeHistory.changedByUserId], references: [users.id] }),
}));

export const employeeOnboardingRelations = relations(employeeOnboarding, ({ one, many }) => ({
  employee: one(employees, { fields: [employeeOnboarding.employeeId], references: [employees.id] }),
  tasks: many(employeeOnboardingTasks),
}));

export const employeeOnboardingTasksRelations = relations(employeeOnboardingTasks, ({ one }) => ({
  onboarding: one(employeeOnboarding, {
    fields: [employeeOnboardingTasks.onboardingId],
    references: [employeeOnboarding.id],
  }),
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
