-- 022: Enable RLS on server-managed CRM tables.
--
-- These tables are intentionally accessed through Next.js API routes using the
-- Supabase service-role client plus explicit tenant checks. We do not add
-- anon/authenticated policies here: direct client access should stay blocked.

ALTER TABLE IF EXISTS quote_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS hiphot_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS quote_branch_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_standard_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS quote_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS hiphot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS quote_email_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ai_quote_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ai_quote_lesson_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS form_submissions ENABLE ROW LEVEL SECURITY;
