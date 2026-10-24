CREATE TABLE "ad_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"change" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"summary" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_visibility_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"engine" text NOT NULL,
	"mentioned" boolean NOT NULL,
	"checked_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"reason" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"agent" text NOT NULL,
	"source_run_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"storage_path" text NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"reason" text,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"platform" text PRIMARY KEY NOT NULL,
	"daily_cap" integer NOT NULL,
	"monthly_cap" integer NOT NULL,
	"spent_today" integer DEFAULT 0 NOT NULL,
	"spent_this_month" integer DEFAULT 0 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"format" text NOT NULL,
	"idea" text NOT NULL,
	"script" text,
	"caption" text,
	"asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'idea' NOT NULL,
	"postiz_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"name" text NOT NULL,
	"objective" text NOT NULL,
	"status" text NOT NULL,
	"daily_budget" integer NOT NULL,
	"spend_7d" integer DEFAULT 0 NOT NULL,
	"clicks_7d" integer DEFAULT 0 NOT NULL,
	"registrations_7d" integer DEFAULT 0 NOT NULL,
	"activations_7d" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"url" text NOT NULL,
	"question" text NOT NULL,
	"draft" text,
	"status" text NOT NULL,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"key" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'not_connected' NOT NULL,
	"secret_ref" text,
	"account_label" text,
	"last_sync_at" timestamp with time zone,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"hypothesis" text NOT NULL,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"started_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"channel" text NOT NULL,
	"spend" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"registrations" integer DEFAULT 0 NOT NULL,
	"activations" integer DEFAULT 0 NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword" text NOT NULL,
	"volume" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"position" integer,
	"intent" text NOT NULL,
	"page_url" text
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"interest" text NOT NULL,
	"assigned_to" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"clicks_28d" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"summary" text NOT NULL,
	"pillars" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'social_manager' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ad_changes" ADD CONSTRAINT "ad_changes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "calendar_scheduled_idx" ON "calendar_items" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "funnel_day_idx" ON "funnel_daily" USING btree ("day");