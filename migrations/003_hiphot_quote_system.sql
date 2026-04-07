-- Migration: HipHot Quote System
-- Date: 2026-04-02
-- Description: Adds tables and columns for HipHot offerte systeem

-- 1. Leads: taal veld
ALTER TABLE leads ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'nl';

-- 2. Quotes: extra velden voor HipHot offertes
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quote_type TEXT DEFAULT 'simple';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS remarks_html TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(10,2);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS shipping_discount_pct NUMERIC(5,2);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS margin_data JSONB;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contact_title TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'nl';

-- 3. HipHot artikelen (lokale kopie van WooCommerce producten)
CREATE TABLE IF NOT EXISTS hiphot_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wc_product_id INTEGER UNIQUE,
  sku TEXT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  inkoop_price NUMERIC(10,2),
  verkoop_price NUMERIC(10,2),
  sale_price NUMERIC(10,2),
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  tenant TEXT DEFAULT 'hiphot',
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Quote line items
CREATE TABLE IF NOT EXISTS quote_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
  article_id UUID REFERENCES hiphot_articles(id) ON DELETE SET NULL,
  wc_product_id INTEGER,
  name TEXT NOT NULL,
  sku TEXT,
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL,
  discount_pct NUMERIC(5,2) DEFAULT 0,
  line_total NUMERIC(10,2) NOT NULL,
  inkoop_price NUMERIC(10,2),
  sort_order INTEGER DEFAULT 0
);

-- 5. Brancheteksten (per branche + per taal)
CREATE TABLE IF NOT EXISTS quote_branch_texts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant TEXT NOT NULL,
  branch_key TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'nl',
  title TEXT,
  body TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Quote emails
CREATE TABLE IF NOT EXISTS quote_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  tenant TEXT NOT NULL,
  to_email TEXT NOT NULL,
  cc_email TEXT,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  language TEXT DEFAULT 'nl',
  resend_id TEXT,
  status TEXT DEFAULT 'sent',
  sent_at TIMESTAMPTZ DEFAULT now(),
  sent_by TEXT
);

-- 7. HipHot fulfillment settings
CREATE TABLE IF NOT EXISTS hiphot_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant TEXT NOT NULL UNIQUE DEFAULT 'hiphot',
  verzendkosten NUMERIC(10,2) DEFAULT 5.99,
  gratis_drempel NUMERIC(10,2) DEFAULT 199.00,
  pickpack_vast NUMERIC(10,2) DEFAULT 2.20,
  pickpack_per_artikel NUMERIC(10,2) DEFAULT 0.40,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default settings
INSERT INTO hiphot_settings (tenant)
VALUES ('hiphot')
ON CONFLICT (tenant) DO NOTHING;
