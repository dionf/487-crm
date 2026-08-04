-- 019: Newsletter exclusion for recent purchasers.
--
-- Adds a company-level last order date and a generic newsletter segment type
-- that can exclude recipients whose company ordered within N days. HipHot gets
-- a default 14-day exclusion to avoid sending offers to recent purchasers.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS last_order_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_tenant_last_order_at
  ON leads (tenant, last_order_at DESC)
  WHERE last_order_at IS NOT NULL;

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

INSERT INTO newsletter_segments (tenant, name, slug, source_type, source_value, default_excluded, sort_order)
VALUES
  ('hiphot', 'Recent besteld (14 dagen)', 'recent-besteld-14-dagen', 'recent_order_days', '14', true, 80)
ON CONFLICT (tenant, slug) DO UPDATE
SET
  source_type = EXCLUDED.source_type,
  source_value = EXCLUDED.source_value,
  default_excluded = true,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();
