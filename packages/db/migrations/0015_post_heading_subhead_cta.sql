ALTER TABLE "calendar_items" ADD COLUMN IF NOT EXISTS "heading" text;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD COLUMN IF NOT EXISTS "subhead" text;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD COLUMN IF NOT EXISTS "cta" text;