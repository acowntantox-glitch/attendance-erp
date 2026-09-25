CREATE TYPE "public"."attendance_exception_type" AS ENUM('LATE', 'INCOMPLETE', 'ABSENT', 'EARLY_DEPARTURE');--> statement-breakpoint
CREATE TABLE "attendance_exception_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" text NOT NULL,
	"exception_type" "attendance_exception_type" NOT NULL,
	"dismissed_by_user_id" uuid NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_exception_dismissals" ADD CONSTRAINT "attendance_exception_dismissals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_exception_dismissals" ADD CONSTRAINT "attendance_exception_dismissals_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_exception_dismissals" ADD CONSTRAINT "attendance_exception_dismissals_dismissed_by_user_id_users_id_fk" FOREIGN KEY ("dismissed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_exception_dismissals_employee_workdate_type_unique" ON "attendance_exception_dismissals" USING btree ("employee_id","work_date","exception_type");--> statement-breakpoint
CREATE INDEX "attendance_exception_dismissals_company_workdate_idx" ON "attendance_exception_dismissals" USING btree ("company_id","work_date");