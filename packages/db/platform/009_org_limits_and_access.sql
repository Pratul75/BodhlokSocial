-- What an agency may have, and how far into each client it may reach.
--
-- Two separate questions that happen to arrive together.
--
-- 1. The ceiling. How many client workspaces an agency may hold and how much AI spend it was
--    sold. Set by the platform, never by the agency: a limit somebody can raise themselves is
--    not a limit. Null means "no ceiling", which is what every agency has until one is set, so
--    nothing that works today stops working.
--
-- 2. How far into a client the agency reaches, per client:
--      full    — its people have accounts inside, and work there as that client's own admins
--      manage  — its people have no accounts inside; the agency sees counts and totals only
--      none    — the client does not appear in the agency's panel at all
--
--    The level is recorded here, but `full` is not enforced from this row: it is enforced by
--    the accounts themselves existing in the client's own `users` table. A flag the application
--    has to remember to check opens quietly the first time somebody forgets it; an account is
--    something the database can see, the client can see on its own People page, and every
--    existing rule already understands.
--
-- Additive and idempotent, like every file in this folder.

ALTER TABLE platform.orgs ADD COLUMN IF NOT EXISTS max_workspaces integer;
ALTER TABLE platform.orgs ADD COLUMN IF NOT EXISTS monthly_budget_usd numeric(10, 2);

CREATE TABLE IF NOT EXISTS platform.org_access (
  org_id     uuid NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES platform.tenants (id) ON DELETE CASCADE,
  level      text NOT NULL DEFAULT 'full',
  set_by     text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, tenant_id)
);

ALTER TABLE platform.org_access DROP CONSTRAINT IF EXISTS org_access_level_check;
ALTER TABLE platform.org_access
  ADD CONSTRAINT org_access_level_check CHECK (level IN ('full', 'manage', 'none'));
