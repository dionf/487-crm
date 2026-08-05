-- 027: Allow campaigns to target multiple newsletter segments.

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS included_segment_ids UUID[] NOT NULL DEFAULT '{}';

UPDATE newsletter_campaigns
SET included_segment_ids = ARRAY[segment_id]::UUID[]
WHERE segment_id IS NOT NULL
  AND coalesce(array_length(included_segment_ids, 1), 0) = 0;
