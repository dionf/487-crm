-- 018: Optional per-campaign newsletter recipient limit.
--
-- This lets admins send a campaign to a small first batch, for example the
-- first 100 eligible recipients, while keeping the preview and Resend segment
-- sync aligned.

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS recipient_limit INTEGER;

ALTER TABLE newsletter_campaigns
  DROP CONSTRAINT IF EXISTS newsletter_campaigns_recipient_limit_check;

ALTER TABLE newsletter_campaigns
  ADD CONSTRAINT newsletter_campaigns_recipient_limit_check
  CHECK (recipient_limit IS NULL OR recipient_limit >= 1);
