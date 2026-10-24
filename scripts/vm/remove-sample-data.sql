-- Removes the sample data loaded by the first deploy (SEED=1) and keeps real records:
-- the admin account, real sign-ins, connections and the brand kit.
-- Run as a superuser with ON_ERROR_STOP; it is one transaction, so a failure changes nothing.
--   psql -v ON_ERROR_STOP=1 -v admin=kshitij@rechargestudio.com -d bodh_growth -f remove-sample-data.sql
BEGIN;

TRUNCATE
  conversion_forwards, conversion_events, ad_spend_daily, web_sessions_daily, funnel_daily,
  pipeline_runs, calendar_items, approvals, assets, creative_jobs, publishing_channels, postiz_calls,
  strategy_plans, campaigns, ad_changes, experiments, keywords, seo_pages, ai_visibility_checks,
  community_items, leads, agent_runs;

-- Keep the record of real sign-ins; everything else in the log came from the seed.
DELETE FROM audit_log WHERE action <> 'sign_in';

-- Placeholder teammates from the seed. Only the admin stays.
DELETE FROM users WHERE email <> :'admin';

-- Caps back to zero, which blocks all ad spend until an admin sets real ones.
UPDATE budgets SET daily_cap = 0, monthly_cap = 0, spent_today = 0, spent_this_month = 0, updated_by = 'setup', updated_at = now();

INSERT INTO audit_log (actor, actor_type, action, target, reason, result)
VALUES (:'admin', 'user', 'remove_sample_data', 'database', 'Requested by the admin', 'sample data removed');

COMMIT;
