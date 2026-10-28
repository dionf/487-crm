-- Webhook-events van per ontvanger verstuurde mails (gepersonaliseerde campagnes)
-- hebben geen broadcast-ID en worden gekoppeld via resend_email_id.
CREATE INDEX IF NOT EXISTS idx_newsletter_campaign_recipients_resend_email
  ON newsletter_campaign_recipients (tenant, resend_email_id)
  WHERE resend_email_id IS NOT NULL;
