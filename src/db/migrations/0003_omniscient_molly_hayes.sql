CREATE TYPE "public"."employee_history_event" AS ENUM('CREATED', 'DEPARTMENT_CHANGED', 'DESIGNATION_CHANGED', 'MANAGER_CHANGED', 'LOCATION_CHANGED', 'EMPLOYMENT_TYPE_CHANGED', 'STATUS_CHANGED', 'PROMOTION', 'TRANSFER', 'RESIGNED', 'TERMINATED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "employee_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"event_type" "employee_history_event" NOT NULL,
	"changed_by_user_id" uuid,
	"effective_date" date,
	"before" jsonb,
	"after" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "department_head_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_history" ADD CONSTRAINT "employee_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_history" ADD CONSTRAINT "employee_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_history" ADD CONSTRAINT "employee_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_history_employee_id_idx" ON "employee_history" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "employee_history_company_id_idx" ON "employee_history" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_department_head_id_employees_id_fk" FOREIGN KEY ("department_head_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "departments_department_head_id_idx" ON "departments" USING btree ("department_head_id");