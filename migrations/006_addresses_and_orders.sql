-- Klant-adressen op leads: factuur + leveradres + factuur-email + referentie
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS billing_street TEXT,
  ADD COLUMN IF NOT EXISTS billing_house_number TEXT,
  ADD COLUMN IF NOT EXISTS billing_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS billing_city TEXT,
  ADD COLUMN IF NOT EXISTS billing_country TEXT DEFAULT 'NL',
  ADD COLUMN IF NOT EXISTS billing_email TEXT,
  ADD COLUMN IF NOT EXISTS customer_reference TEXT,
  ADD COLUMN IF NOT EXISTS delivery_same_as_billing BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS delivery_street TEXT,
  ADD COLUMN IF NOT EXISTS delivery_house_number TEXT,
  ADD COLUMN IF NOT EXISTS delivery_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS delivery_city TEXT,
  ADD COLUMN IF NOT EXISTS delivery_country TEXT DEFAULT 'NL';

-- Order-koppeling op quotes
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS external_order_id TEXT,
  ADD COLUMN IF NOT EXISTS external_order_platform TEXT,
  ADD COLUMN IF NOT EXISTS external_order_url TEXT,
  ADD COLUMN IF NOT EXISTS external_order_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS order_customer_reference TEXT;

-- Index voor snellere lookup op 'al omgezet naar order' checks
CREATE INDEX IF NOT EXISTS idx_quotes_external_order_id ON quotes(external_order_id) WHERE external_order_id IS NOT NULL;
