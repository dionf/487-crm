-- 012: marketing-attributie velden voor Google Ads / GA tracking
--
-- gclid  = klassieke Google Ads click ID (web → web)
-- gbraid = iOS app conversions (vanaf iOS 14.5)
-- wbraid = web-to-app conversions
--
-- Capturen op het moment van eerste touchpoint (form-submit / chatbot-intake),
-- opslaan op zowel form_submissions (per touchpoint) als leads (eerste touchpoint
-- wint — handig voor toekomstige offerte-akkoord conversie via offline imports).

ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS gclid TEXT,
  ADD COLUMN IF NOT EXISTS gbraid TEXT,
  ADD COLUMN IF NOT EXISTS wbraid TEXT,
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_content TEXT,
  ADD COLUMN IF NOT EXISTS utm_term TEXT,
  ADD COLUMN IF NOT EXISTS referrer TEXT,
  ADD COLUMN IF NOT EXISTS lead_type TEXT;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS gclid TEXT,
  ADD COLUMN IF NOT EXISTS gbraid TEXT,
  ADD COLUMN IF NOT EXISTS wbraid TEXT,
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_content TEXT,
  ADD COLUMN IF NOT EXISTS utm_term TEXT,
  ADD COLUMN IF NOT EXISTS referrer TEXT,
  ADD COLUMN IF NOT EXISTS lead_type TEXT;

-- Indexen voor lookup tijdens offline conversion exports
CREATE INDEX IF NOT EXISTS idx_leads_gclid ON leads (gclid) WHERE gclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_gbraid ON leads (gbraid) WHERE gbraid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_wbraid ON leads (wbraid) WHERE wbraid IS NOT NULL;
