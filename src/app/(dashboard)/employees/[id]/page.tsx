import Link from "next/link";
import { notFound } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { getEmployee, getOnboarding, listEmployeeDocuments, listEmployeeHistory } from "@/domains/employee/service";
import { EmployeeNotFoundError } from "@/domains/employee/errors";
import {
  getCompanyDefaultWeeklyOff,
  getEmployeeWeeklyOffOverride,
  listEmployeeScheduleAssignments,
  listShifts,
  listWorkSchedules,
} from "@/domains/workforce/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmployeeStatusBadge } from "@/components/employees/employee-status-badge";
import { EmployeeHistoryTimeline } from "@/components/employees/employee-history-timeline";
import { EmployeeOnboardingChecklist } from "@/components/employees/employee-onboarding-checklist";
import { EmployeeDocumentsPanel } from "@/components/employees/employee-documents-panel";
import { EmployeeSchedulePanel } from "@/components/workforce/employee-schedule-panel";
import { EmployeeWeeklyOffPanel } from "@/components/workforce/employee-weekly-off-panel";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value || "—"}</dd>
    </div>
  );
}

export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext();
  const { id } = await params;

  let employee;
  try {
    employee = await getEmployee(ctx, id);
  } catch (error) {
    if (error instanceof EmployeeNotFoundError) notFound();
    throw error;
  }

  const canEdit = can(ctx.role, "employee.update");
  const canManageDocuments = can(ctx.role, "employee.manage_documents");
  const canCreateAssignment = can(ctx.role, "employee_schedule.create");
  const canViewCompanyWeeklyOffDefault = can(ctx.role, "weekly_off.view");
  const canManageWeeklyOffOverride = can(ctx.role, "weekly_off.create");

  const [history, onboarding, documents, scheduleAssignments, weeklyOffOverride, companyDefaultWeeklyOff, workSchedules, shifts] =
    await Promise.all([
      listEmployeeHistory(ctx, id),
      getOnboarding(ctx, id),
      listEmployeeDocuments(ctx, id),
      listEmployeeScheduleAssignments(ctx, id),
      getEmployeeWeeklyOffOverride(ctx, id),
      canViewCompanyWeeklyOffDefault ? getCompanyDefaultWeeklyOff(ctx) : Promise.resolve(null),
      canCreateAssignment ? listWorkSchedules(ctx) : Promise.resolve([]),
      canCreateAssignment ? listShifts(ctx) : Promise.resolve([]),
    ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            {employee.firstName} {employee.lastName}
          </h1>
          <p className="text-sm text-slate-500">
            {employee.employeeNumber} · {employee.designation?.name ?? "No designation"} ·{" "}
            {employee.department?.name ?? "No department"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <EmployeeStatusBadge status={employee.employmentStatus} />
          {can(ctx.role, "attendance.view") && (
            <Link href={`/employees/${employee.id}/attendance`}>
              <Button variant="secondary">Attendance</Button>
            </Link>
          )}
          {canEdit && (
            <Link href={`/employees/${employee.id}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
          <TabsTrigger value="workforce">Workforce</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Employee Number" value={employee.employeeNumber} />
                  <Field label="Designation" value={employee.designation?.name} />
                  <Field label="Department" value={employee.department?.name} />
                  <Field label="Location" value={employee.location?.name} />
                  <Field
                    label="Manager"
                    value={employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : null}
                  />
                  <Field label="Joining Date" value={employee.dateOfJoining} />
                  <Field label="Employment Type" value={employee.employmentType.replaceAll("_", " ")} />
                  <Field label="Onboarding" value={employee.onboardingStatus.replaceAll("_", " ")} />
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Contact</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Work Email" value={employee.workEmail} />
                  <Field label="Personal Email" value={employee.personalEmail} />
                  <Field label="Phone" value={employee.phone} />
                  <Field label="Alternate Phone" value={employee.alternatePhone} />
                  <Field label="Address" value={employee.address} />
                  <Field label="City" value={employee.city} />
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Emergency Contact</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Name" value={employee.emergencyContactName} />
                  <Field label="Phone" value={employee.emergencyContactPhone} />
                  <Field label="Relationship" value={employee.emergencyContactRelationship} />
                </dl>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <EmployeeDocumentsPanel employeeId={employee.id} documents={documents} canManage={canManageDocuments} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Employment History</CardTitle>
            </CardHeader>
            <CardContent>
              <EmployeeHistoryTimeline history={history} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="onboarding">
          <Card>
            <CardHeader>
              <CardTitle>Onboarding</CardTitle>
            </CardHeader>
            <CardContent>
              <EmployeeOnboardingChecklist
                employeeId={employee.id}
                onboarding={onboarding}
                onboardingStatus={employee.onboardingStatus}
                canManage={canEdit}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workforce">
          <div className="space-y-6">
            {can(ctx.role, "workforce_calendar.view") && (
              <div className="flex justify-end">
                <Link href={`/workforce/calendar?employeeId=${employee.id}`} className="text-sm text-blue-700 hover:underline">
                  View Workforce Calendar →
                </Link>
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Schedule Assignment</CardTitle>
              </CardHeader>
              <CardContent>
                <EmployeeSchedulePanel
                  employeeId={employee.id}
                  assignments={scheduleAssignments}
                  workSchedules={workSchedules}
                  shifts={shifts}
                  canCreate={canCreateAssignment}
                  today={today}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Weekly Off</CardTitle>
              </CardHeader>
              <CardContent>
                <EmployeeWeeklyOffPanel
                  employeeId={employee.id}
                  override={weeklyOffOverride}
                  companyDefault={companyDefaultWeeklyOff}
                  canViewCompanyDefault={canViewCompanyWeeklyOffDefault}
                  canManage={canManageWeeklyOffOverride}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
