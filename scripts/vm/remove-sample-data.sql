-- Removes the sample data loaded by the first deploy (SEED=1) and keeps real records:
-- the admin account, people added in Admin, real sign-ins, connections, Postiz channel
-- mappings, creative jobs, the Postiz call ledger and the brand kit.
-- Run as a superuser with ON_ERROR_STOP; it is one transaction, so a failure changes nothing.
--   psql -v ON_ERROR_STOP=1 -v admin=kshitij@rechargestudio.com -d bodh_growth -f remove-sample-data.sql
--
-- The content tables below are emptied whole: anything real written to them before this runs
-- (calendar items, uploads, plans) goes too. Run it before the team starts using the app.
BEGIN;

-- Refuse to run twice, or on a database that was never seeded.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'seed_sample_data') THEN
    RAISE EXCEPTION 'No sample data marker (audit_log action seed_sample_data): nothing to remove.';
  END IF;
END $$;

TRUNCATE
  conversion_forwards, conversion_events, ad_spend_daily, web_sessions_daily, funnel_daily,
  pipeline_runs, approvals,
  strategy_plans, campaigns, ad_changes, experiments, keywords, seo_pages, ai_visibility_checks,
  community_items, directory_listings, reports, leads, agent_runs;

-- Kept tables point at these two (brand_kit.logo_asset_id, postiz_calls.calendar_item_id), so
-- TRUNCATE would refuse; DELETE lets those references fall back to NULL.
DELETE FROM calendar_items;
DELETE FROM assets;

-- Keep the record of real sign-ins; everything else in the log came from the seed.
-- This also removes the seed_sample_data marker, which turns off the "Sample data" badge.
DELETE FROM audit_log WHERE action <> 'sign_in';

-- The four placeholder teammates the seed creates. People added in Admin stay.
DELETE FROM users
WHERE email IN ('ads@rechargestudio.com', 'seo@rechargestudio.com', 'social@rechargestudio.com', 'sales@rechargestudio.com')
  AND email <> :'admin';

-- Caps back to zero, which blocks all ad spend until an admin sets real ones.
UPDATE budgets SET daily_cap = 0, monthly_cap = 0, spent_today = 0, spent_this_month = 0, updated_by = 'setup', updated_at = now();

-- The catalog pages come back as "planned" when the worker restarts (ensurePageCatalog).
INSERT INTO audit_log (actor, actor_type, action, target, reason, result)
VALUES (:'admin', 'user', 'remove_sample_data', 'database', 'Requested by the admin', 'sample data removed');

COMMIT;
