CREATE TABLE "geo_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geo_questions_question_unique" UNIQUE("question")
);
--> statement-breakpoint
CREATE TABLE "seo_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target" text NOT NULL,
	"task_id" text NOT NULL,
	"status" text NOT NULL,
	"pages_crawled" integer DEFAULT 0 NOT NULL,
	"onpage_score" numeric(5, 2),
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_visibility_checks" ADD COLUMN "answer" text;--> statement-breakpoint
ALTER TABLE "ai_visibility_checks" ADD COLUMN "competitors" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_visibility_checks" ADD COLUMN "citations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_visibility_checks" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "keywords" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "keywords" ADD COLUMN "clicks_28d" integer;--> statement-breakpoint
ALTER TABLE "keywords" ADD COLUMN "impressions_28d" integer;--> statement-breakpoint
ALTER TABLE "keywords" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "keyword" text;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "brief" text;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "answer" text;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "faq" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "needs_review" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_visibility_checked_idx" ON "ai_visibility_checks" USING btree ("checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "keywords_keyword_idx" ON "keywords" USING btree ("keyword");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_pages_template_slug_idx" ON "seo_pages" USING btree ("template","slug");--> statement-breakpoint
CREATE INDEX "seo_pages_status_idx" ON "seo_pages" USING btree ("status");