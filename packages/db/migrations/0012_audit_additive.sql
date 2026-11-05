-- 0012: audit changes on top of the live release (47ff99c). Additive only: new tables
-- (directory_listings, reports), new nullable or defaulted columns, indexes, foreign keys on
-- existing columns (ON DELETE SET NULL), and CHECK rules that existing production values already
-- satisfy (checked 5 Nov 2026). No DROP, DELETE, UPDATE or type change. leads (the CRM mirror)
-- is untouched, and strategy_plans keeps live's "superseded" re-plan history. If any check
-- fails on data added since then, the whole migration rolls back and nothing changes.
CREATE TABLE "directory_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"category" text NOT NULL,
	"why" text NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'found' NOT NULL,
	"review_note" text,
	"approval_id" uuid,
	"run_id" uuid,
	"submitted_url" text,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directory_listings_status_check" CHECK ("directory_listings"."status" in ('found', 'drafted', 'in_review', 'approved', 'submitted', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_kind_check" CHECK ("reports"."kind" in ('weekly', 'monthly'))
);
--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "place" text;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "why" text;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "posted_url" text;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "posted_by" text;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD COLUMN "occurred_ist" date GENERATED ALWAYS AS (((occurred_at AT TIME ZONE 'Asia/Kolkata')::date)) STORED;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "directory_listings" ADD CONSTRAINT "directory_listings_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_listings" ADD CONSTRAINT "directory_listings_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "directory_listings_url_uq" ON "directory_listings" USING btree ("url");--> statement-breakpoint
CREATE INDEX "directory_listings_status_idx" ON "directory_listings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_kind_period_uq" ON "reports" USING btree ("kind","period_start");--> statement-breakpoint
ALTER TABLE "ad_changes" ADD CONSTRAINT "ad_changes_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_changes" ADD CONSTRAINT "ad_changes_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_calendar_item_id_calendar_items_id_fk" FOREIGN KEY ("calendar_item_id") REFERENCES "public"."calendar_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_job_id_creative_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."creative_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_logo_asset_id_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_items" ADD CONSTRAINT "community_items_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_items" ADD CONSTRAINT "community_items_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postiz_calls" ADD CONSTRAINT "postiz_calls_calendar_item_id_calendar_items_id_fk" FOREIGN KEY ("calendar_item_id") REFERENCES "public"."calendar_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD CONSTRAINT "seo_pages_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_changes_created_idx" ON "ad_changes" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_one_active_idx" ON "agent_runs" USING btree ("agent") WHERE "agent_runs"."status" in ('queued', 'running') and "agent_runs"."agent" <> 'chat';--> statement-breakpoint
CREATE INDEX "agent_runs_agent_started_idx" ON "agent_runs" USING btree ("agent","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_started_idx" ON "agent_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "approvals_calendar_item_idx" ON "approvals" USING btree ("calendar_item_id");--> statement-breakpoint
CREATE INDEX "approvals_kind_status_idx" ON "approvals" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "calendar_status_scheduled_idx" ON "calendar_items" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "calendar_postiz_idx" ON "calendar_items" USING btree ("postiz_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_platform_external_uq" ON "community_items" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "community_status_found_idx" ON "community_items" USING btree ("status","found_at");--> statement-breakpoint
CREATE INDEX "conv_occurred_ist_idx" ON "conversion_events" USING btree ("occurred_ist");--> statement-breakpoint
CREATE INDEX "experiments_entity_status_idx" ON "experiments" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "seo_audits_status_idx" ON "seo_audits" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "seo_pages_site_status_idx" ON "seo_pages" USING btree ("site_status");--> statement-breakpoint
CREATE INDEX "strategy_plans_month_idx" ON "strategy_plans" USING btree ("month");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_kind_check" CHECK ("approvals"."kind" in ('post', 'ad_change', 'reply', 'listing', 'blog', 'page'));--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_status_check" CHECK ("approvals"."status" in ('pending', 'approved', 'rejected', 'withdrawn'));--> statement-breakpoint
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_singleton_check" CHECK ("brand_kit"."id" = 1);--> statement-breakpoint
ALTER TABLE "calendar_items" ADD CONSTRAINT "calendar_items_status_check" CHECK ("calendar_items"."status" in ('idea', 'drafted', 'in_review', 'approved', 'scheduled', 'published', 'failed'));--> statement-breakpoint
ALTER TABLE "community_items" ADD CONSTRAINT "community_items_status_check" CHECK ("community_items"."status" in ('found', 'drafted', 'in_review', 'approved', 'posted', 'skipped', 'failed'));--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_status_check" CHECK ("connections"."status" in ('not_connected', 'connected', 'error', 'pending_review'));--> statement-breakpoint
ALTER TABLE "strategy_plans" ADD CONSTRAINT "strategy_plans_status_check" CHECK ("strategy_plans"."status" in ('draft', 'approved', 'superseded'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin', 'ads_manager', 'seo_manager', 'social_manager', 'sales'));