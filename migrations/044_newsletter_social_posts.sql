-- 044: Optionele LinkedIn- en Instagram-posts bij nieuwsbriefitems.
--
-- Per editie kiest de redacteur zelf voor welke items hij een post wil; er
-- wordt niets automatisch gegenereerd. Eén rij per item en kanaal. De posts
-- zijn generiek (niet per bedrijf) en staan los van de goedkeuringen van de
-- nieuwsbrief: bewerken laat de testmail niet vervallen.
--
-- content (jsonb):
--   linkedin:  { hook, body, hashtags: [] }
--   instagram: { caption, hashtags: [], image_suggestion }

create table if not exists newsletter_campaign_social_posts (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  campaign_id uuid not null references newsletter_campaigns(id) on delete cascade,
  item_id uuid not null references newsletter_campaign_items(id) on delete cascade,
  channel text not null check (channel in ('linkedin', 'instagram')),
  content jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  edited_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, channel)
);

create index if not exists newsletter_campaign_social_posts_campaign_idx
  on newsletter_campaign_social_posts (campaign_id);

-- Alleen de server (service role) leest en schrijft deze tabel, zie 022.
alter table newsletter_campaign_social_posts enable row level security;
