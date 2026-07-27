-- 014: HubSpot contact metadata for the HipHot migration.
--
-- Marketing permission, segments and tags remain company-level on leads. These
-- contact fields only make the HubSpot import idempotent and auditable.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS hubspot_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_imported_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_tenant_hubspot_contact_id
  ON contacts (tenant, hubspot_contact_id)
  WHERE hubspot_contact_id IS NOT NULL;
