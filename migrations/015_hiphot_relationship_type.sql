-- 015: HipHot relationship/value classification for imported HubSpot records.
--
-- This is separate from pipeline status. Pipeline remains sales stage; this
-- field lets HipHot filter customers, mail contacts, newsletter contacts and
-- low-signal HubSpot records in the Leads/Bellijst view.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS relationship_type TEXT;

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_relationship_type_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_relationship_type_check
  CHECK (
    relationship_type IS NULL
    OR relationship_type IN (
      'customer',
      'mail_contact',
      'newsletter_contact',
      'website_activity',
      'hubspot_record'
    )
  );

CREATE INDEX IF NOT EXISTS idx_leads_tenant_relationship_type
  ON leads (tenant, relationship_type)
  WHERE relationship_type IS NOT NULL;
