-- 022: Enable RLS on server-managed CRM tables.
--
-- These tables are intentionally accessed through Next.js API routes using the
-- Supabase service-role client plus explicit tenant checks. We do not add
-- anon/authenticated policies here: direct client access should stay blocked.
--
-- Backfill child tenants first: API routes now filter child rows by tenant, so
-- old child rows without tenant must inherit the authoritative leads.tenant
-- before the security hardening is enabled.

DO $$
BEGIN
  IF to_regclass('public.notes') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'notes' AND column_name = 'tenant'
     ) THEN
    UPDATE public.notes n
    SET tenant = l.tenant
    FROM public.leads l
    WHERE n.lead_id = l.id
      AND n.tenant IS NULL
      AND l.tenant IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.activities') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'activities' AND column_name = 'tenant'
     ) THEN
    UPDATE public.activities a
    SET tenant = l.tenant
    FROM public.leads l
    WHERE a.lead_id = l.id
      AND a.tenant IS NULL
      AND l.tenant IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.form_submissions') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'form_submissions' AND column_name = 'tenant'
     ) THEN
    UPDATE public.form_submissions f
    SET tenant = l.tenant
    FROM public.leads l
    WHERE f.lead_id = l.id
      AND f.tenant IS NULL
      AND l.tenant IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.contacts') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'tenant'
     ) THEN
    UPDATE public.contacts c
    SET tenant = l.tenant
    FROM public.leads l
    WHERE c.lead_id = l.id
      AND c.tenant IS NULL
      AND l.tenant IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.quotes') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'quotes' AND column_name = 'tenant'
     ) THEN
    UPDATE public.quotes q
    SET tenant = l.tenant
    FROM public.leads l
    WHERE q.lead_id = l.id
      AND q.tenant IS NULL
      AND l.tenant IS NOT NULL;
  END IF;
END $$;

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
