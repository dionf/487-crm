-- 020: Make the HipHot recent-order newsletter segment optional in existing databases.
--
-- Migration 019 originally seeded this segment as default_excluded=true. Existing
-- environments that already ran that version need this forward migration so the
-- segment remains available as a choice, but is no longer applied automatically.

UPDATE newsletter_segments
SET
  default_excluded = false,
  updated_at = now()
WHERE tenant = 'hiphot'
  AND slug = 'recent-besteld-14-dagen';
