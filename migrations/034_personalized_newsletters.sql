-- 034: Gepersonaliseerde nieuwsbrieven.
--
-- Een campagne in mode 'personalized' heeft geen vaste body_html, maar
-- gestructureerde items (per sectie) en per ontvangend bedrijf een set
-- AI-geschreven, door een mens goedgekeurde "slots":
--   subject, preheader, intro, item:<item_id>
-- Welke slots er zijn hangt af van personalization_layout:
--   intro    = alleen intro-hook
--   per_item = per item een "waarom interessant"-regel
--   combined = intro-hook + regel bij de 1-2 meest relevante items

alter table newsletter_campaigns
  add column if not exists mode text not null default 'broadcast',
  add column if not exists personalization_layout text not null default 'combined',
  add column if not exists headline text,
  add column if not exists intro_text text;

alter table newsletter_campaigns alter column body_html drop not null;

alter table newsletter_campaigns drop constraint if exists newsletter_campaigns_mode_check;
alter table newsletter_campaigns
  add constraint newsletter_campaigns_mode_check check (mode in ('broadcast', 'personalized'));

alter table newsletter_campaigns drop constraint if exists newsletter_campaigns_personalization_layout_check;
alter table newsletter_campaigns
  add constraint newsletter_campaigns_personalization_layout_check
  check (personalization_layout in ('intro', 'per_item', 'combined'));

create table if not exists newsletter_campaign_items (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  campaign_id uuid not null references newsletter_campaigns(id) on delete cascade,
  section text not null check (section in ('company_news', 'ai_news', 'tips')),
  title text not null,
  body text not null default '',
  url text,
  link_label text,
  image_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists newsletter_campaign_items_campaign_idx
  on newsletter_campaign_items (campaign_id, section, sort_order);

create table if not exists newsletter_campaign_personalizations (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  campaign_id uuid not null references newsletter_campaigns(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  slot text not null,
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  generated_at timestamptz,
  edited_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id, slot)
);

create index if not exists newsletter_campaign_personalizations_campaign_idx
  on newsletter_campaign_personalizations (campaign_id, lead_id);

-- Alleen de server (service role) leest en schrijft deze tabellen, zie 022.
alter table newsletter_campaign_items enable row level security;
alter table newsletter_campaign_personalizations enable row level security;
