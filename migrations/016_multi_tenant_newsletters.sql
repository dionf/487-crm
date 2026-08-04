-- 016: Multi-tenant newsletter campaigns via tenant-owned Resend accounts.
--
-- CRM remains the source for marketing permission. Resend is used for
-- contacts, segments, broadcasts, unsubscribes and delivery events.

CREATE TABLE IF NOT EXISTS newsletter_settings (
  tenant TEXT PRIMARY KEY,
  resend_api_key_encrypted TEXT,
  resend_api_key_last4 TEXT,
  resend_webhook_secret_encrypted TEXT,
  from_name TEXT,
  from_email TEXT,
  reply_to TEXT,
  domain_status TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newsletter_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'all_marketing',
  source_value TEXT,
  default_excluded BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant, slug)
);

ALTER TABLE newsletter_segments
  ADD COLUMN IF NOT EXISTS default_excluded BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE newsletter_segments
  DROP CONSTRAINT IF EXISTS newsletter_segments_source_type_check;

ALTER TABLE newsletter_segments
  ADD CONSTRAINT newsletter_segments_source_type_check
  CHECK (
    source_type IN (
      'all_marketing',
      'marketing_segment',
      'without_marketing_segments',
      'lead_status',
      'relationship_type',
      'hubspot_deal_origin',
      'industry',
      'recipient_email_contains',
      'recent_order_days'
    )
  );

CREATE TABLE IF NOT EXISTS newsletter_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant TEXT NOT NULL,
  segment_id UUID REFERENCES newsletter_segments(id) ON DELETE SET NULL,
  excluded_segment_ids UUID[] NOT NULL DEFAULT '{}',
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  preview_text TEXT,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  recipient_limit INTEGER,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  resend_segment_id TEXT,
  resend_broadcast_id TEXT,
  test_sent_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  sent_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS excluded_segment_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS recipient_limit INTEGER;

ALTER TABLE newsletter_campaigns
  DROP CONSTRAINT IF EXISTS newsletter_campaigns_recipient_limit_check;

ALTER TABLE newsletter_campaigns
  ADD CONSTRAINT newsletter_campaigns_recipient_limit_check
  CHECK (recipient_limit IS NULL OR recipient_limit >= 1);

ALTER TABLE newsletter_campaigns
  DROP CONSTRAINT IF EXISTS newsletter_campaigns_status_check;

ALTER TABLE newsletter_campaigns
  ADD CONSTRAINT newsletter_campaigns_status_check
  CHECK (
    status IN (
      'draft',
      'tested',
      'approved',
      'syncing',
      'scheduled',
      'sent',
      'failed'
    )
  );

CREATE TABLE IF NOT EXISTS newsletter_campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant TEXT NOT NULL,
  campaign_id UUID NOT NULL REFERENCES newsletter_campaigns(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  name TEXT,
  company_name TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  resend_contact_id TEXT,
  resend_email_id TEXT,
  last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant, campaign_id, email)
);

CREATE TABLE IF NOT EXISTS newsletter_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant TEXT NOT NULL,
  campaign_id UUID REFERENCES newsletter_campaigns(id) ON DELETE SET NULL,
  recipient_id UUID REFERENCES newsletter_campaign_recipients(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  email TEXT,
  resend_email_id TEXT,
  resend_broadcast_id TEXT,
  payload JSONB,
  occurred_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE newsletter_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_events ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies on purpose: newsletter data contains API-key
-- metadata, campaign HTML and recipient snapshots. Access runs through
-- authenticated CRM API routes with service role plus explicit tenant filters.

CREATE INDEX IF NOT EXISTS idx_newsletter_segments_tenant
  ON newsletter_segments (tenant, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_newsletter_campaigns_tenant
  ON newsletter_campaigns (tenant, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_newsletter_campaign_recipients_tenant_campaign
  ON newsletter_campaign_recipients (tenant, campaign_id);

CREATE INDEX IF NOT EXISTS idx_newsletter_campaign_recipients_email
  ON newsletter_campaign_recipients (tenant, email);

CREATE INDEX IF NOT EXISTS idx_newsletter_events_tenant_campaign
  ON newsletter_events (tenant, campaign_id, created_at DESC);

INSERT INTO newsletter_segments (tenant, name, slug, source_type, source_value, sort_order)
VALUES
  ('hiphot', 'Algemene nieuwsbrief', 'algemene-nieuwsbrief', 'all_marketing', NULL, 10),
  ('hiphot', 'Factor 30', 'factor-30', 'marketing_segment', 'factor_30', 20),
  ('hiphot', 'Factor 50', 'factor-50', 'marketing_segment', 'factor_50', 30),
  ('hiphot', 'Zonder Factor 30/50', 'zonder-factor-30-50', 'without_marketing_segments', 'factor_30,factor_50', 40)
ON CONFLICT (tenant, slug) DO NOTHING;

INSERT INTO newsletter_segments (tenant, name, slug, source_type, source_value, default_excluded, sort_order)
VALUES
  ('hiphot', 'Recent besteld (14 dagen)', 'recent-besteld-14-dagen', 'recent_order_days', '14', true, 80),
  ('hiphot', 'Bol.com Customers', 'bol-com-customers', 'recipient_email_contains', 'bol.com', true, 90)
ON CONFLICT (tenant, slug) DO UPDATE
SET
  source_type = EXCLUDED.source_type,
  source_value = EXCLUDED.source_value,
  default_excluded = true,
  updated_at = now();
