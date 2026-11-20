-- Repeated wrong passwords on a console account.
--
-- Workspace users got this when passwords reached them; operators did not, which had the
-- asymmetry the wrong way round — a console account reaches every workspace, so it is the one
-- that least deserves an unlimited number of guesses. scrypt already makes each guess expensive;
-- this makes the ninth one free to refuse.
--
-- Additive and idempotent, like every file in this folder.

ALTER TABLE platform.platform_operators ADD COLUMN IF NOT EXISTS failed_sign_ins integer NOT NULL DEFAULT 0;
ALTER TABLE platform.platform_operators ADD COLUMN IF NOT EXISTS locked_until timestamptz;
