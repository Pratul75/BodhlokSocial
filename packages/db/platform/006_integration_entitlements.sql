-- A third kind of entitlement: which outside accounts a workspace may connect at all.
--
-- Separate from modules and features because it answers a different question — not "may they
-- use this part of the product" but "may they reach this company's API from here". An account
-- a workspace was never given cannot be connected, so no credential for it can exist there.
--
-- Additive and idempotent, like every file in this folder.

ALTER TABLE platform.entitlements DROP CONSTRAINT IF EXISTS entitlements_kind_check;
ALTER TABLE platform.entitlements
  ADD CONSTRAINT entitlements_kind_check CHECK (kind IN ('module', 'feature', 'capacity', 'integration'));
