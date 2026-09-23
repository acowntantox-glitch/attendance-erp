CREATE TYPE "public"."holiday_type" AS ENUM('PUBLIC', 'RELIGIOUS', 'COMPANY', 'OPTIONAL');--> statement-breakpoint
CREATE TABLE "employee_schedule_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_schedule_id" uuid NOT NULL,
	"shift_id" uuid,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"assigned_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"holiday_type" "holiday_type" NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"break_duration_minutes" integer,
	"break_start_time" time,
	"is_break_paid" boolean DEFAULT false NOT NULL,
	"grace_period_minutes" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_company_code_unique" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "weekly_off_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid,
	"off_days" integer[] NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"timezone" text,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"break_duration_minutes" integer,
	"break_start_time" time,
	"is_break_paid" boolean DEFAULT false NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_schedules_company_name_unique" UNIQUE("company_id","name")
);
--> statement-breakpoint
ALTER TABLE "employee_schedule_assignments" ADD CONSTRAINT "employee_schedule_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_schedule_assignments" ADD CONSTRAINT "employee_schedule_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_schedule_assignments" ADD CONSTRAINT "employee_schedule_assignments_work_schedule_id_work_schedules_id_fk" FOREIGN KEY ("work_schedule_id") REFERENCES "public"."work_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_schedule_assignments" ADD CONSTRAINT "employee_schedule_assignments_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_schedule_assignments" ADD CONSTRAINT "employee_schedule_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_off_rules" ADD CONSTRAINT "weekly_off_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_off_rules" ADD CONSTRAINT "weekly_off_rules_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_schedule_assignments_open_unique" ON "employee_schedule_assignments" USING btree ("employee_id") WHERE "employee_schedule_assignments"."effective_to" is null;--> statement-breakpoint
CREATE INDEX "employee_schedule_assignments_employee_from_idx" ON "employee_schedule_assignments" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "employee_schedule_assignments_company_from_idx" ON "employee_schedule_assignments" USING btree ("company_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_company_date_unique" ON "holidays" USING btree ("company_id","date") WHERE "holidays"."branch_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_branch_date_unique" ON "holidays" USING btree ("branch_id","date") WHERE "holidays"."branch_id" is not null;--> statement-breakpoint
CREATE INDEX "holidays_company_date_idx" ON "holidays" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "holidays_branch_date_idx" ON "holidays" USING btree ("branch_id","date");--> statement-breakpoint
CREATE INDEX "shifts_company_id_idx" ON "shifts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "shifts_company_active_idx" ON "shifts" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_off_rules_company_default_unique" ON "weekly_off_rules" USING btree ("company_id") WHERE "weekly_off_rules"."employee_id" is null and "weekly_off_rules"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_off_rules_employee_open_unique" ON "weekly_off_rules" USING btree ("employee_id") WHERE "weekly_off_rules"."employee_id" is not null and "weekly_off_rules"."effective_to" is null;--> statement-breakpoint
CREATE INDEX "weekly_off_rules_company_id_idx" ON "weekly_off_rules" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "weekly_off_rules_employee_id_idx" ON "weekly_off_rules" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "work_schedules_company_id_idx" ON "work_schedules" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "work_schedules_company_active_idx" ON "work_schedules" USING btree ("company_id","is_active");