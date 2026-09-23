import type {
  employeeScheduleAssignments,
  holidays,
  holidayTypeEnum,
  shifts,
  weeklyOffRules,
  workSchedules,
} from "@/db/schema";

export type WorkSchedule = typeof workSchedules.$inferSelect;
export type Shift = typeof shifts.$inferSelect;
export type EmployeeScheduleAssignment = typeof employeeScheduleAssignments.$inferSelect;
export type EmployeeScheduleAssignmentWithRelations = EmployeeScheduleAssignment & {
  workSchedule: WorkSchedule;
  shift: Shift | null;
};
export type WeeklyOffRule = typeof weeklyOffRules.$inferSelect;
export type Holiday = typeof holidays.$inferSelect;
export type HolidayType = (typeof holidayTypeEnum.enumValues)[number];

export type CreateWorkScheduleInput = {
  name: string;
  description?: string;
  timezone?: string;
  startTime: string;
  endTime: string;
  breakDurationMinutes?: number;
  breakStartTime?: string;
  isBreakPaid?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
};

export type UpdateWorkScheduleInput = Partial<CreateWorkScheduleInput>;

export type CreateShiftInput = {
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  breakDurationMinutes?: number;
  breakStartTime?: string;
  isBreakPaid?: boolean;
  gracePeriodMinutes?: number;
};

export type UpdateShiftInput = Partial<Omit<CreateShiftInput, "code">>;

export type AssignEmployeeScheduleInput = {
  workScheduleId: string;
  shiftId?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  note?: string;
  /** Explicit opt-in to create an assignment that overlaps an existing one — always audited. */
  allowOverlap?: boolean;
};

export type UpdateEmployeeScheduleAssignmentInput = {
  effectiveTo?: string | null;
  note?: string;
};

export type SetWeeklyOffRuleInput = {
  offDays: number[];
  effectiveFrom?: string;
  effectiveTo?: string;
};

export type CreateHolidayInput = {
  branchId?: string;
  name: string;
  date: string;
  holidayType: HolidayType;
  description?: string;
};

export type UpdateHolidayInput = Partial<Omit<CreateHolidayInput, "date" | "branchId">>;

export type ExpectedShiftWindow = {
  start: { date: string; time: string };
  end: { date: string; time: string };
  spansMidnight: boolean;
  breakDurationMinutes: number | null;
  breakStartTime: string | null;
  isBreakPaid: boolean;
};

export type WeeklyOffSource = "employee_override" | "company_default" | "none";

/**
 * The single, reusable answer to "what applied to this employee on this date" — computed once in
 * `getWorkforceDayInfo` and reused by the calendar API/UI and (later) the Attendance calculation
 * engine, so the precedence rules only ever live in one place.
 */
export type WorkforceDayInfo = {
  date: string;
  employeeId: string;
  companyId: string;
  timezone: string;
  isHoliday: boolean;
  holiday: Holiday | null;
  isWeeklyOff: boolean;
  weeklyOffSource: WeeklyOffSource;
  scheduleAssignment: EmployeeScheduleAssignmentWithRelations | null;
  isWorkingDay: boolean;
  expectedWindow: ExpectedShiftWindow | null;
};

export type UpcomingScheduleChange = EmployeeScheduleAssignmentWithRelations & {
  employee: { id: string; firstName: string; lastName: string; employeeNumber: string };
};

export type EmployeeScheduleAssignmentWithHistory = EmployeeScheduleAssignmentWithRelations & {
  assignedBy: { id: string; fullName: string } | null;
};

export type WorkforceDashboardSummary = {
  date: string;
  employeesScheduledToday: number;
  employeesOffToday: number;
  employeesOnHolidayToday: number;
  activeShiftCount: number;
  upcomingScheduleChanges: UpcomingScheduleChange[];
};
