-- 0013: GA4 Data API reports (website and app traffic for the property in GA4_PROPERTY_ID).
-- Additive only: four new tables and their indexes. No existing table or row is changed.
CREATE TABLE "ga4_daily" (
	"property_id" text NOT NULL,
	"day" date NOT NULL,
	"platform" text NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"engaged_sessions" integer DEFAULT 0 NOT NULL,
	"active_users" integer DEFAULT 0 NOT NULL,
	"new_users" integer DEFAULT 0 NOT NULL,
	"total_users" integer DEFAULT 0 NOT NULL,
	"screen_page_views" integer DEFAULT 0 NOT NULL,
	"user_engagement_seconds" integer DEFAULT 0 NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ga4_daily_pk" PRIMARY KEY("property_id","day","platform")
);
--> statement-breakpoint
CREATE TABLE "ga4_daily_pages" (
	"property_id" text NOT NULL,
	"day" date NOT NULL,
	"page_path" text NOT NULL,
	"screen_page_views" integer DEFAULT 0 NOT NULL,
	"active_users" integer DEFAULT 0 NOT NULL,
	"user_engagement_seconds" integer DEFAULT 0 NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ga4_daily_pages_pk" PRIMARY KEY("property_id","day","page_path")
);
--> statement-breakpoint
CREATE TABLE "ga4_daily_sources" (
	"property_id" text NOT NULL,
	"day" date NOT NULL,
	"channel_group" text NOT NULL,
	"source" text NOT NULL,
	"medium" text NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"engaged_sessions" integer DEFAULT 0 NOT NULL,
	"new_users" integer DEFAULT 0 NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ga4_daily_sources_pk" PRIMARY KEY("property_id","day","channel_group","source","medium")
);
--> statement-breakpoint
CREATE TABLE "ga4_period_totals" (
	"property_id" text NOT NULL,
	"range_days" integer NOT NULL,
	"start_day" date NOT NULL,
	"end_day" date NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"engaged_sessions" integer DEFAULT 0 NOT NULL,
	"active_users" integer DEFAULT 0 NOT NULL,
	"total_users" integer DEFAULT 0 NOT NULL,
	"new_users" integer DEFAULT 0 NOT NULL,
	"screen_page_views" integer DEFAULT 0 NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ga4_period_totals_pk" PRIMARY KEY("property_id","range_days")
);
--> statement-breakpoint
CREATE INDEX "ga4_daily_day_idx" ON "ga4_daily" USING btree ("day");--> statement-breakpoint
CREATE INDEX "ga4_daily_pages_day_idx" ON "ga4_daily_pages" USING btree ("day");--> statement-breakpoint
CREATE INDEX "ga4_daily_sources_day_idx" ON "ga4_daily_sources" USING btree ("day");