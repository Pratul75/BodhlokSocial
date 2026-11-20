-- Passwords for platform operators, and one-time links for setting them.
--
-- The console used to let anybody who knew an operator's address sign in, which was only ever
-- safe because it refused to run outside development. An operator now has a password, hashed
-- with scrypt, and a reset link an owner issues: there is no mail service here, so a link is
-- handed over rather than sent, and it is single-use and short-lived.
--
-- Additive and idempotent, like every file in this folder.

ALTER TABLE platform.platform_operators ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE platform.platform_operators ADD COLUMN IF NOT EXISTS password_set_at timestamptz;
ALTER TABLE platform.platform_operators ADD COLUMN IF NOT EXISTS reset_token_hash text;
ALTER TABLE platform.platform_operators ADD COLUMN IF NOT EXISTS reset_expires_at timestamptz;
ALTER TABLE platform.platform_operators ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- A reset token is looked up by its hash, never by the value in the link.
CREATE INDEX IF NOT EXISTS platform_operators_reset_idx
  ON platform.platform_operators (reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;
