-- The control plane. Additive and idempotent: it creates a new schema beside the tenants'
-- own schemas and never touches an existing table. Safe to run on every deploy.
--
-- Tenant data is NOT here. Tenant #1 keeps living in `public`, untouched, and is registered
-- by the row inserted at the end of provisioning.

CREATE SCHEMA IF NOT EXISTS platform;

-- A connection with no tenant selected lands here and finds nothing, so the query fails
-- loudly instead of quietly reading tenant #1.
CREATE SCHEMA IF NOT EXISTS nothing_here;

CREATE TABLE IF NOT EXISTS platform.tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL,
  name          text NOT NULL,
  data_schema   text NOT NULL,
  db_role       text,
  -- The tenant role's password. Readable only by the owner connection: tenant roles are
  -- granted their own schema and nothing else, so none of them can read this table.
  db_role_secret text,
  status        text NOT NULL DEFAULT 'provisioning',
  plan          text NOT NULL DEFAULT 'full',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_status_check CHECK (status IN ('provisioning', 'active', 'suspended', 'archived'))
);
CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_uq ON platform.tenants (slug);
CREATE UNIQUE INDEX IF NOT EXISTS tenants_schema_uq ON platform.tenants (data_schema);

CREATE TABLE IF NOT EXISTS platform.platform_operators (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  name            text NOT NULL,
  role            text NOT NULL DEFAULT 'support',
  active          boolean NOT NULL DEFAULT true,
  session_version integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_operators_role_check CHECK (role IN ('owner', 'support', 'billing'))
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_operators_email_uq ON platform.platform_operators (email);

CREATE TABLE IF NOT EXISTS platform.entitlements (
  tenant_id  uuid NOT NULL REFERENCES platform.tenants (id) ON DELETE CASCADE,
  kind       text NOT NULL,
  key        text NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  value      numeric(14, 2),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entitlements_kind_check CHECK (kind IN ('module', 'feature', 'capacity', 'integration'))
);
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_pk ON platform.entitlements (tenant_id, kind, key);

CREATE TABLE IF NOT EXISTS platform.tenant_settings (
  tenant_id  uuid NOT NULL REFERENCES platform.tenants (id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      text,
  secret     boolean NOT NULL DEFAULT false,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_settings_pk ON platform.tenant_settings (tenant_id, key);

CREATE TABLE IF NOT EXISTS platform.user_directory (
  email      text NOT NULL,
  tenant_id  uuid NOT NULL REFERENCES platform.tenants (id) ON DELETE CASCADE,
  active     boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_directory_pk ON platform.user_directory (email, tenant_id);
CREATE INDEX IF NOT EXISTS user_directory_email_idx ON platform.user_directory (email);

CREATE TABLE IF NOT EXISTS platform.platform_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor      text NOT NULL,
  action     text NOT NULL,
  target     text NOT NULL,
  tenant_id  uuid REFERENCES platform.tenants (id) ON DELETE SET NULL,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_audit_created_idx ON platform.platform_audit (created_at);

CREATE TABLE IF NOT EXISTS platform.impersonations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES platform.platform_operators (id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES platform.tenants (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  user_email  text NOT NULL,
  reason      text NOT NULL,
  expires_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS impersonations_active_idx ON platform.impersonations (tenant_id, expires_at);
