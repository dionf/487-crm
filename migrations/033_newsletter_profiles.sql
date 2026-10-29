-- 033: Nieuwsbriefprofiel per bedrijf.
--
-- Neutrale beschrijving van wat een bedrijf doet, als basis voor de
-- AI-personalisatie in de nieuwsbrief. Bewust los van leads.ai_summary: die
-- bevat interne verkoopnotities ("Kansen voor 48-7", "Gesprekstip") die nooit
-- in een mail aan de klant mogen belanden.

alter table leads
  add column if not exists newsletter_profile text,
  add column if not exists newsletter_profile_status text,
  add column if not exists newsletter_profile_updated_at timestamptz;

alter table leads drop constraint if exists leads_newsletter_profile_status_check;
alter table leads
  add constraint leads_newsletter_profile_status_check
  check (newsletter_profile_status is null or newsletter_profile_status in ('draft', 'approved'));
