-- 041: Beeld in de nieuwsbrief, bedrijfslogo's en voorbeeldbedrijven.
--
-- * leads.logo_url: logo van het bedrijf (nieuwsbrief, later ook offertes).
-- * newsletter_campaigns.hero_image_url: grote afbeelding bovenaan de mail.
-- * newsletter_campaigns.sample_lead_ids: bedrijven waarvoor je een
--   voorbeeldversie maakt (testmail of preview-link), zonder dat ze in de
--   doelgroep zitten. Ze worden nooit echt verzonden.
-- * Storage-bucket "media": publiek leesbaar, want mailclients halen de
--   afbeeldingen zonder login op. Schrijven gaat alleen via de service role.

alter table leads add column if not exists logo_url text;

alter table newsletter_campaigns
  add column if not exists hero_image_url text,
  add column if not exists sample_lead_ids uuid[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
