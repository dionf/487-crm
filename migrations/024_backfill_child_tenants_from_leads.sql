-- 024: Backfill tenant values on child records from their lead.
--
-- Some older imports/intake paths created child rows before every child table
-- was consistently tenant-populated. The API now filters these child rows by
-- tenant, so backfill from the authoritative leads.tenant before relying on
-- those filters everywhere. Migration 022 already performs the same backfill
-- before enabling RLS; this migration is intentionally kept idempotent as a
-- standalone safety net for environments where operators run it separately.

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
