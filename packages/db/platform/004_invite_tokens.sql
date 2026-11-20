-- Which workspace a password link belongs to.
--
-- The link's real check lives inside the workspace, on the person's own `users` row. But the
-- page that opens the link has no session and no workspace in the address — the whole point of
-- the address being `/set-password?token=…` and not `/t/zenith/set-password?token=…` — so
-- something has to say which schema to look in. That is all this is: a hash and a workspace id.
--
-- It holds no name, no address and nothing that opens an account. A forged row here buys
-- nothing: the hash still has to match a live row inside that workspace.
--
-- Additive and idempotent, like every file in this folder.

CREATE TABLE IF NOT EXISTS platform.invite_tokens (
  token_hash text PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invite_tokens_expiry_idx ON platform.invite_tokens (expires_at);
