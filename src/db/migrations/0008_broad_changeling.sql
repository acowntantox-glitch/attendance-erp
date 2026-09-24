CREATE TYPE "public"."attendance_correction_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."attendance_daily_status" AS ENUM('PRESENT', 'LATE', 'ABSENT', 'INCOMPLETE', 'WEEKLY_OFF', 'HOLIDAY', 'WEEKLY_OFF_WORKED', 'HOLIDAY_WORKED', 'NO_SCHEDULE');--> statement-breakpoint
CREATE TYPE "public"."attendance_event_type" AS ENUM('CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END');--> statement-breakpoint
CREATE TYPE "public"."attendance_session_status" AS ENUM('OPEN', 'CLOSED', 'ABANDONED');--> statement-breakpoint
CREATE TYPE "public"."attendance_source" AS ENUM('MANUAL');--> statement-breakpoint
CREATE TABLE "attendance_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"requested_by_user_id" uuid,
	"reason" text NOT NULL,
	"requested_change" jsonb NOT NULL,
	"status" "attendance_correction_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_daily_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"status" "attendance_daily_status" NOT NULL,
	"scheduled_minutes" integer DEFAULT 0 NOT NULL,
	"worked_minutes" integer,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer,
	"late_minutes" integer,
	"early_departure_minutes" integer,
	"first_check_in_at" timestamp with time zone,
	"last_check_out_at" timestamp with time zone,
	"session_count" integer DEFAULT 0 NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"event_type" "attendance_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" "attendance_source" DEFAULT 'MANUAL' NOT NULL,
	"source_metadata" jsonb,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_open_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"status" "attendance_session_status" DEFAULT 'OPEN' NOT NULL,
	"check_in_at" timestamp with time zone NOT NULL,
	"check_out_at" timestamp with time zone,
	"expected_work_schedule_id" uuid,
	"expected_shift_id" uuid,
	"expected_start_at" timestamp with time zone,
	"expected_end_at" timestamp with time zone,
	"resolved_timezone" text,
	"grace_period_minutes" integer DEFAULT 0 NOT NULL,
	"is_holiday" boolean DEFAULT false NOT NULL,
	"is_weekly_off" boolean DEFAULT false NOT NULL,
	"is_working_day" boolean DEFAULT true NOT NULL,
	"source" "attendance_source" DEFAULT 'MANUAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_daily_records" ADD CONSTRAINT "attendance_daily_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_daily_records" ADD CONSTRAINT "attendance_daily_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_session_id_attendance_open_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_open_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_open_sessions" ADD CONSTRAINT "attendance_open_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_open_sessions" ADD CONSTRAINT "attendance_open_sessions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_open_sessions" ADD CONSTRAINT "attendance_open_sessions_expected_work_schedule_id_work_schedules_id_fk" FOREIGN KEY ("expected_work_schedule_id") REFERENCES "public"."work_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_open_sessions" ADD CONSTRAINT "attendance_open_sessions_expected_shift_id_shifts_id_fk" FOREIGN KEY ("expected_shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_corrections_company_employee_workdate_idx" ON "attendance_corrections" USING btree ("company_id","employee_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_corrections_company_status_idx" ON "attendance_corrections" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_daily_records_employee_workdate_unique" ON "attendance_daily_records" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_daily_records_company_workdate_idx" ON "attendance_daily_records" USING btree ("company_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_events_idempotency_unique" ON "attendance_events" USING btree ("employee_id","idempotency_key") WHERE "attendance_events"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "attendance_events_session_id_idx" ON "attendance_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "attendance_events_company_employee_workdate_idx" ON "attendance_events" USING btree ("company_id","employee_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_events_employee_occurred_idx" ON "attendance_events" USING btree ("employee_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_open_sessions_employee_open_unique" ON "attendance_open_sessions" USING btree ("employee_id") WHERE "attendance_open_sessions"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "attendance_open_sessions_employee_checkin_idx" ON "attendance_open_sessions" USING btree ("employee_id","check_in_at");--> statement-breakpoint
CREATE INDEX "attendance_open_sessions_company_workdate_idx" ON "attendance_open_sessions" USING btree ("company_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_open_sessions_employee_workdate_idx" ON "attendance_open_sessions" USING btree ("employee_id","work_date");