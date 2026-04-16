-- Add tenant column to lead_inbox_log for multi-tenant IMAP polling
ALTER TABLE lead_inbox_log
  ADD COLUMN IF NOT EXISTS tenant TEXT;

-- Backfill existing rows: everything before multi-tenant belongs to 48-7
UPDATE lead_inbox_log SET tenant = '48-7' WHERE tenant IS NULL;

-- Index for per-tenant log queries
CREATE INDEX IF NOT EXISTS idx_lead_inbox_log_tenant ON lead_inbox_log(tenant);
