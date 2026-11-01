-- 047: Relevantie per item per bedrijf in de gepersonaliseerde nieuwsbrief.
--
-- Bij de opzet "combinatie" kiest de AI zelf bij welke items een regel
-- "Waarom dit interessant is" komt. Voorheen waren dat er vast hooguit 2.
--
-- max_item_lines     maximum aantal itemregels per bedrijf (standaard 3).
-- personalize_all    item krijgt bij elk bedrijf een regel ("voor iedereen");
--                    telt mee voor het maximum en gaat voor.
-- item_scores        per bedrijf en item de score van de AI (sterk, mogelijk,
--                    niet) met een korte reden, voor het overzicht. Ook items
--                    zonder regel krijgen een score. Personalisaties van vóór
--                    deze migratie hebben geen scores; het overzicht toont dan
--                    alleen of er een tekst is.

alter table newsletter_campaigns
  add column if not exists max_item_lines integer not null default 3;

alter table newsletter_campaigns drop constraint if exists newsletter_campaigns_max_item_lines_check;
alter table newsletter_campaigns
  add constraint newsletter_campaigns_max_item_lines_check check (max_item_lines between 0 and 20);

alter table newsletter_campaign_items
  add column if not exists personalize_all boolean not null default false;

create table if not exists newsletter_campaign_item_scores (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  campaign_id uuid not null references newsletter_campaigns(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  item_id uuid not null references newsletter_campaign_items(id) on delete cascade,
  score text not null check (score in ('sterk', 'mogelijk', 'niet')),
  reason text,
  created_at timestamptz not null default now(),
  unique (campaign_id, lead_id, item_id)
);

create index if not exists newsletter_campaign_item_scores_campaign_idx
  on newsletter_campaign_item_scores (campaign_id);

-- Alleen de server (service role) leest en schrijft deze tabel, zie 022.
alter table newsletter_campaign_item_scores enable row level security;
