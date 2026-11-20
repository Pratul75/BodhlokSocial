-- Who runs an agency.
--
-- Deliberately NOT a third kind of principal. Platform operators are their own table, their own
-- cookie and their own session audience, because a workspace admin must never be able to become
-- one. An organization admin is different: everything they can do, they do as themselves inside
-- workspaces they already belong to. So they sign in the way everybody else does, and this table
-- only says which agency they run.
--
-- An address, not a user id: the same person is a separate row in every workspace's own `users`
-- table, and which of those rows they are depends on which workspace they are looking at. The
-- address is the one thing that is the same everywhere, and it is what sign-in and the control
-- plane's directory are keyed by already.
--
-- Additive and idempotent, like every file in this folder.

CREATE TABLE IF NOT EXISTS platform.org_admins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES platform.orgs (id) ON DELETE CASCADE,
  email      text NOT NULL,
  -- Who appointed them, for the audit trail that follows.
  added_by   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per person per agency. Somebody may run two agencies; they may not be listed twice
-- for one.
CREATE UNIQUE INDEX IF NOT EXISTS org_admins_uq ON platform.org_admins (org_id, email);
CREATE INDEX IF NOT EXISTS org_admins_email_idx ON platform.org_admins (email);
