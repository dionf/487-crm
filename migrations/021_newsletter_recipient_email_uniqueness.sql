-- 021: Enforce normalized unique newsletter recipient emails per campaign.
--
-- The app already builds recipients through a normalized e-mail map. This
-- migration adds a database backstop so a campaign snapshot can never contain
-- the same e-mail address more than once, even with case or whitespace changes.

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant, campaign_id, lower(btrim(email))
      ORDER BY created_at ASC, id ASC
    ) AS row_number
  FROM newsletter_campaign_recipients
)
DELETE FROM newsletter_campaign_recipients recipients
USING ranked
WHERE recipients.id = ranked.id
  AND ranked.row_number > 1;

UPDATE newsletter_campaign_recipients
SET
  email = lower(btrim(email)),
  updated_at = now()
WHERE email <> lower(btrim(email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_campaign_recipients_unique_email_normalized
  ON newsletter_campaign_recipients (tenant, campaign_id, lower(btrim(email)));

ALTER TABLE newsletter_campaign_recipients
  DROP CONSTRAINT IF EXISTS newsletter_campaign_recipients_email_normalized_check;

ALTER TABLE newsletter_campaign_recipients
  ADD CONSTRAINT newsletter_campaign_recipients_email_normalized_check
  CHECK (email = lower(btrim(email)));
