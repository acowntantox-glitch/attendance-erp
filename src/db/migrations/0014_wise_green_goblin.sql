CREATE TYPE "public"."attendance_processing_run_status" AS ENUM('RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."attendance_processing_trigger" AS ENUM('SCHEDULED', 'MANUAL');--> statement-breakpoint
CREATE TABLE "attendance_processing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"trigger" "attendance_processing_trigger" NOT NULL,
	"status" "attendance_processing_run_status" DEFAULT 'RUNNING' NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_processing_runs" ADD CONSTRAINT "attendance_processing_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_processing_runs_running_unique" ON "attendance_processing_runs" USING btree ("company_id","work_date") WHERE "attendance_processing_runs"."status" = 'RUNNING';--> statement-breakpoint
CREATE INDEX "attendance_processing_runs_company_started_idx" ON "attendance_processing_runs" USING btree ("company_id","started_at");