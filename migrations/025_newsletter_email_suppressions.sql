-- 025: Store newsletter opt-outs and bounces per recipient e-mail address.
--
-- Company-level marketing consent decides whether a company may receive
-- newsletters at all. A recipient unsubscribe must not unsubscribe the whole
-- company when the company has multiple contacts, so suppressed addresses are
-- tracked separately and filtered out during preview/send.

CREATE TABLE IF NOT EXISTS newsletter_email_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unsubscribed',
  reason TEXT,
  source TEXT,
  resend_broadcast_id TEXT,
  resend_email_id TEXT,
  payload JSONB,
  suppressed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant, email)
);

UPDATE newsletter_email_suppressions
SET
  email = lower(btrim(email)),
  updated_at = now()
WHERE email <> lower(btrim(email));

ALTER TABLE newsletter_email_suppressions
  DROP CONSTRAINT IF EXISTS newsletter_email_suppressions_email_normalized_check;

ALTER TABLE newsletter_email_suppressions
  ADD CONSTRAINT newsletter_email_suppressions_email_normalized_check
  CHECK (email = lower(btrim(email)));

ALTER TABLE newsletter_email_suppressions
  DROP CONSTRAINT IF EXISTS newsletter_email_suppressions_status_check;

ALTER TABLE newsletter_email_suppressions
  ADD CONSTRAINT newsletter_email_suppressions_status_check
  CHECK (status IN ('unsubscribed', 'hard_bounce', 'non_marketing'));

ALTER TABLE newsletter_email_suppressions ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies on purpose: access runs through authenticated
-- CRM API routes with service role plus explicit tenant filters.

CREATE INDEX IF NOT EXISTS idx_newsletter_email_suppressions_tenant_status
  ON newsletter_email_suppressions (tenant, status);
