-- 013: Lock down public-schema RLS — sluit anon-key toegang volledig af.
--
-- ACHTERGROND
-- De hele public-schema was leesbaar én schrijfbaar via de (per definitie publieke)
-- anon-key: 12 tabellen zonder RLS, en de overige CRM-tabellen met een wijd-open
-- policy (role `public`, cmd ALL, USING true / WITH CHECK true). De app benadert
-- Supabase uitsluitend server-side; na de codewijziging in deze branch gebruikt ze
-- de SUPABASE_SERVICE_ROLE_KEY, die RLS bypasst. Daarom kunnen we RLS overal
-- aanzetten en de open anon-policies verwijderen zonder de app te breken.
--
-- !!! VOLGORDE — DEPLOY EERST DE APP-CODE (anon → SUPABASE_SERVICE_ROLE_KEY) NAAR
-- !!! PRODUCTIE, DRAAI DAARNA PAS DEZE MIGRATIE. Andersom breekt de CRM tussen de
-- !!! twee stappen in. Zie SECURITY_FIX_HANDOFF.md voor de volledige volgorde.
--
-- Eindstaat: anon/authenticated krijgen NUL toegang tot de public-schema; alleen
-- service_role (server-side) en de Postgres-owner houden toegang. Een gelekte
-- anon-key is daarmee waardeloos.

begin;

-- 1) RLS aanzetten op de 12 tabellen die het uit hadden staan.
alter table public.ai_quote_lesson_flags     enable row level security;
alter table public.ai_quote_lessons           enable row level security;
alter table public.email_standard_attachments enable row level security;
alter table public.email_templates            enable row level security;
alter table public.form_submissions           enable row level security;
alter table public.hiphot_articles            enable row level security;
alter table public.hiphot_settings            enable row level security;
alter table public.organizations              enable row level security;
alter table public.quote_branch_texts         enable row level security;
alter table public.quote_email_attachments    enable row level security;
alter table public.quote_emails               enable row level security;
alter table public.quote_line_items           enable row level security;

-- 2) De wijd-open "alles voor iedereen" policies verwijderen.
--    RLS blijft aan; zonder policy = deny-all voor anon/authenticated.
--    service_role bypasst RLS en houdt volledige toegang.
drop policy if exists "Allow anon access"                       on public.activities;
drop policy if exists "Allow anon access"                       on public.attachments;
drop policy if exists "Allow all operations on contacts"        on public.contacts;
drop policy if exists "Allow all operations on follow_up_tasks" on public.follow_up_tasks;
drop policy if exists "Allow anon access"                       on public.lead_inbox_log;
drop policy if exists "Allow anon access"                       on public.leads;
drop policy if exists "Allow anon access"                       on public.notes;
drop policy if exists "All access quote_sections"               on public.quote_sections;
drop policy if exists "All access quote_templates"              on public.quote_templates;
drop policy if exists "Allow anon access"                       on public.quotes;
drop policy if exists "Allow all on users"                      on public.users;
drop policy if exists "Anyone can insert quote views"          on public.quote_views;
drop policy if exists "Anyone can read quote views"            on public.quote_views;

commit;

-- ROLLBACK (alleen indien iets onverwacht breekt):
--   -- één tabel tijdelijk weer openzetten:
--   create policy "tmp open" on public.<tabel> for all to public using (true) with check (true);
--   -- of RLS uitzetten op één tabel:
--   alter table public.<tabel> disable row level security;
