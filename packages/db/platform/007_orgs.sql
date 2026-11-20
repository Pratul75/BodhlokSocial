-- Organizations: the agency a workspace belongs to.
--
-- A workspace is a client. An organization is the agency that holds clients — and its own
-- workspace alongside them, because an agency does its own marketing too. The organization
-- itself holds no data: no schema, no role, no tables. It exists so that workspaces can be
-- grouped, billed and administered together, and so that an agency can be given its own
-- console later without any of this having to move.
--
-- Deliberately NOT a tenant with children. A tenant is a schema and a database role; an
-- organization is neither. Had it been the same table, every rule in the system would need to
-- ask "is this the kind of tenant that holds data?" — and the first place that forgot to ask
-- would be a bug nobody could see.
--
-- `tenants.org_id` is nullable here and filled in by the migrate step, which creates the first
-- organization and puts every existing workspace in it. Nothing is moved and no data changes:
-- one column gains a value.
--
-- Additive and idempotent, like every file in this folder.

CREATE TABLE IF NOT EXISTS platform.orgs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Short name, used in links and logs. Unlike a tenant slug this is not a schema name, so it
  -- is free to change; it is kept unique all the same, because two agencies with one short
  -- name is a support call waiting to happen.
  slug       text NOT NULL,
  name       text NOT NULL,
  -- active | suspended | archived. Same vocabulary as tenants, same meaning: anything that is
  -- not active is closed, and only an active organization is offered at sign-in.
  status     text NOT NULL DEFAULT 'active',
  -- The label the plan was sold under. Entitlements remain the truth.
  plan       text NOT NULL DEFAULT 'full',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS orgs_slug_uq ON platform.orgs (slug);

-- Which agency a workspace belongs to. ON DELETE RESTRICT on purpose: deleting an organization
-- out from under its workspaces would leave them unreachable from the console and owned by
-- nobody. Removing an organization has to mean dealing with its workspaces first, and that is
-- a decision for a person, not a cascade.
ALTER TABLE platform.tenants
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES platform.orgs (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS tenants_org_idx ON platform.tenants (org_id);
