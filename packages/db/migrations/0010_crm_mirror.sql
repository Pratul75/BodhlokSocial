CREATE TABLE "billing_accounts" (
	"mp_account_id" text PRIMARY KEY NOT NULL,
	"user_ref" text,
	"subscription_id" text,
	"status" text,
	"plan" text,
	"synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_lead_id" text NOT NULL,
	"kind" text DEFAULT 'lead' NOT NULL,
	"source" text,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"stage_id" text,
	"value" numeric(12, 2),
	"fb_campaign_id" text,
	"fb_adset_id" text,
	"fb_ad_id" text,
	"fb_form_id" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"user_ref" text,
	"email_sha256" text,
	"phone_sha256" text,
	"crm_created_at" timestamp with time zone NOT NULL,
	"crm_updated_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"last_event" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_crm_lead_id_unique" UNIQUE("crm_lead_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"invoice_id" text PRIMARY KEY NOT NULL,
	"mp_account_id" text NOT NULL,
	"user_ref" text,
	"number" text,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"total_paise" integer NOT NULL,
	"gst_paise" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"plan" text,
	"paid_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"delivery_key" text NOT NULL,
	"event" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "funnel_daily" ADD COLUMN "leads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "funnel_daily" ADD COLUMN "revenue" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "leads_created_idx" ON "leads" USING btree ("crm_created_at");--> statement-breakpoint
CREATE INDEX "leads_ad_idx" ON "leads" USING btree ("fb_ad_id");--> statement-breakpoint
CREATE INDEX "payments_paid_idx" ON "payments" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_source_key_uq" ON "webhook_deliveries" USING btree ("source","delivery_key");--> statement-breakpoint
CREATE INDEX "webhook_received_idx" ON "webhook_deliveries" USING btree ("received_at");