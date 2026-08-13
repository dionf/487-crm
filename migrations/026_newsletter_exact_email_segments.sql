-- 026: Allow exact recipient e-mail list segments for safe small test sends.

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
      'recipient_email_in',
      'recipient_email_contains',
      'recent_order_days'
    )
  );
