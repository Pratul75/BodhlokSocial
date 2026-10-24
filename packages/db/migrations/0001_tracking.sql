CREATE TABLE "ad_spend_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"platform" text NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"ad_id" text NOT NULL,
	"ad_name" text NOT NULL,
	"spend" numeric(12, 2) NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversion_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_ref" text NOT NULL,
	"platform" text NOT NULL,
	"plan" text,
	"value" numeric(12, 2),
	"currency" text DEFAULT 'INR' NOT NULL,
	"email_sha256" text,
	"phone_sha256" text,
	"channel" text NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"gclid" text,
	"gbraid" text,
	"wbraid" text,
	"fbclid" text,
	"fbp" text,
	"fbc" text,
	"referral_code" text,
	"referrer" text,
	"landing_page" text,
	"client_ip" text,
	"user_agent" text,
	CONSTRAINT "conversion_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "conversion_forwards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"destination" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"rows" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "web_sessions_daily" (
	"day" date NOT NULL,
	"channel" text NOT NULL,
	"sessions" integer NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversion_forwards" ADD CONSTRAINT "conversion_forwards_event_id_conversion_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."conversion_events"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spend_day_ad_uq" ON "ad_spend_daily" USING btree ("day","platform","ad_id");--> statement-breakpoint
CREATE INDEX "conv_occurred_idx" ON "conversion_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "conv_user_idx" ON "conversion_events" USING btree ("user_ref","type");--> statement-breakpoint
CREATE INDEX "conv_content_idx" ON "conversion_events" USING btree ("utm_content");--> statement-breakpoint
CREATE UNIQUE INDEX "forward_event_dest_uq" ON "conversion_forwards" USING btree ("event_id","destination");--> statement-breakpoint
CREATE INDEX "forward_due_idx" ON "conversion_forwards" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "pipeline_job_idx" ON "pipeline_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_day_channel_uq" ON "web_sessions_daily" USING btree ("day","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_day_channel_uq" ON "funnel_daily" USING btree ("day","channel");