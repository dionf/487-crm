-- 017: Newsletter exclusion segments.
--
-- Adds campaign-level exclusion segments and seeds a HipHot default exclusion
-- for Bol.com customer addresses. This is additive and tenant-scoped.

ALTER TABLE newsletter_segments
  ADD COLUMN IF NOT EXISTS default_excluded BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS excluded_segment_ids UUID[] NOT NULL DEFAULT '{}';

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
  ('hiphot', 'Recent besteld (14 dagen)', 'recent-besteld-14-dagen', 'recent_order_days', '14', false, 80),
  ('hiphot', 'Bol.com Customers', 'bol-com-customers', 'recipient_email_contains', 'bol.com', true, 90)
ON CONFLICT (tenant, slug) DO UPDATE
SET
  source_type = EXCLUDED.source_type,
  source_value = EXCLUDED.source_value,
  default_excluded = EXCLUDED.default_excluded,
  updated_at = now();
