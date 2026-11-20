-- Deleting a workspace, in two steps that cannot be collapsed into one.
--
-- "Delete" in the console means ARCHIVE: the workspace stops answering, every session in it
-- dies, and its schema is left exactly where it is. Nothing is lost, and it can be brought
-- back. A workspace deleted by mistake on a Friday is still there on Monday.
--
-- Only after the retention window has passed can an owner PURGE it, which drops the schema and
-- its roles and is not recoverable. Two steps, days apart, each with its own confirmation —
-- because the alternative is one button between a customer and their data.
--
-- `archived` joins `active` and `suspended` as a tenant status; the status column has no check
-- constraint, and every read path already treats anything that is not `active` as closed.
--
-- Additive and idempotent, like every file in this folder.

ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS archived_by text;
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS archived_reason text;
-- The earliest moment a purge is allowed. Set when archiving; nothing may purge before it.
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS purge_after timestamptz;

CREATE INDEX IF NOT EXISTS tenants_archived_idx ON platform.tenants (archived_at) WHERE archived_at IS NOT NULL;
