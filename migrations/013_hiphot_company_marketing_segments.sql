-- 013: HipHot HubSpot marketing migration fields on company/lead records
--
-- HipHot newsletter targeting is managed at company level. Contact persons can
-- remain recipients, but marketing permission, HubSpot status, and segments
-- such as Factor 30 / Factor 50 live on the tenant-scoped leads record.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_segments TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS marketing_subscription_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS marketing_consent_source TEXT,
  ADD COLUMN IF NOT EXISTS marketing_consent_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_unsubscribed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_hard_bounced BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hubspot_company_id TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_contact_ids TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hubspot_imported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hubspot_subscription_status TEXT;

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_marketing_subscription_status_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_marketing_subscription_status_check
  CHECK (
    marketing_subscription_status IN (
      'unknown',
      'subscribed',
      'unsubscribed',
      'hard_bounce',
      'non_marketing'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_tenant_hubspot_company_id
  ON leads (tenant, hubspot_company_id)
  WHERE hubspot_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_tenant_marketing_consent
  ON leads (tenant, marketing_consent)
  WHERE marketing_consent = true;

CREATE INDEX IF NOT EXISTS idx_leads_marketing_segments
  ON leads USING GIN (marketing_segments);
