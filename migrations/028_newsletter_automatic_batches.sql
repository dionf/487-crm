-- 028: Automatic newsletter batches with guarded health checks.

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS batch_mode TEXT NOT NULL DEFAULT 'single';

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS batch_size INTEGER;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS batch_wait_hours NUMERIC NOT NULL DEFAULT 4;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS batch_next_run_at TIMESTAMPTZ;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS batch_current_number INTEGER NOT NULL DEFAULT 0;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS batch_total_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS batch_last_health JSONB;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS batch_pause_reason TEXT;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS batch_alert_sent_at TIMESTAMPTZ;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS batch_started_at TIMESTAMPTZ;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS max_bounce_rate NUMERIC NOT NULL DEFAULT 0.02;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS max_complaint_rate NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS max_failed_rate NUMERIC NOT NULL DEFAULT 0.03;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS max_unsubscribe_rate NUMERIC NOT NULL DEFAULT 0.05;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS domain_last_checked_at TIMESTAMPTZ;

ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS domain_check JSONB;

ALTER TABLE newsletter_campaigns
  DROP CONSTRAINT IF EXISTS newsletter_campaigns_batch_mode_check;

ALTER TABLE newsletter_campaigns
  ADD CONSTRAINT newsletter_campaigns_batch_mode_check
  CHECK (batch_mode IN ('single', 'automatic'));

ALTER TABLE newsletter_campaigns
  DROP CONSTRAINT IF EXISTS newsletter_campaigns_batch_size_check;

ALTER TABLE newsletter_campaigns
  ADD CONSTRAINT newsletter_campaigns_batch_size_check
  CHECK (batch_size IS NULL OR batch_size >= 1);

ALTER TABLE newsletter_campaigns
  DROP CONSTRAINT IF EXISTS newsletter_campaigns_batch_wait_hours_check;

ALTER TABLE newsletter_campaigns
  ADD CONSTRAINT newsletter_campaigns_batch_wait_hours_check
  CHECK (batch_wait_hours >= 0.25);

ALTER TABLE newsletter_campaigns
  DROP CONSTRAINT IF EXISTS newsletter_campaigns_batch_thresholds_check;

ALTER TABLE newsletter_campaigns
  ADD CONSTRAINT newsletter_campaigns_batch_thresholds_check
  CHECK (
    max_bounce_rate >= 0 AND max_bounce_rate <= 1
    AND max_complaint_rate >= 0 AND max_complaint_rate <= 1
    AND max_failed_rate >= 0 AND max_failed_rate <= 1
    AND max_unsubscribe_rate >= 0 AND max_unsubscribe_rate <= 1
  );

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
      'failed',
      'batch_waiting',
      'paused'
    )
  );

ALTER TABLE newsletter_campaign_recipients
  ADD COLUMN IF NOT EXISTS batch_number INTEGER;

ALTER TABLE newsletter_campaign_recipients
  ADD COLUMN IF NOT EXISTS resend_segment_id TEXT;

ALTER TABLE newsletter_campaign_recipients
  ADD COLUMN IF NOT EXISTS resend_broadcast_id TEXT;

CREATE TABLE IF NOT EXISTS newsletter_campaign_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant TEXT NOT NULL,
  campaign_id UUID NOT NULL REFERENCES newsletter_campaigns(id) ON DELETE CASCADE,
  batch_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  recipient_count INTEGER NOT NULL DEFAULT 0,
  resend_segment_id TEXT,
  resend_broadcast_id TEXT,
  health JSONB,
  pause_reason TEXT,
  sent_at TIMESTAMPTZ,
  health_checked_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant, campaign_id, batch_number)
);

ALTER TABLE newsletter_campaign_batches ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_newsletter_campaign_batches_tenant_campaign
  ON newsletter_campaign_batches (tenant, campaign_id, batch_number);

CREATE INDEX IF NOT EXISTS idx_newsletter_campaigns_batch_next_run
  ON newsletter_campaigns (tenant, status, batch_next_run_at)
  WHERE status = 'batch_waiting';

CREATE INDEX IF NOT EXISTS idx_newsletter_campaign_recipients_batch
  ON newsletter_campaign_recipients (tenant, campaign_id, batch_number);
