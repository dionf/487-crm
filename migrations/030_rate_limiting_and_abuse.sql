-- 030: rate limiting & anti-abuse state
--
-- Tot nu toe had alleen de publieke intake een limiet, en die telde uitsluitend
-- per e-mailadres. Daarmee bleven twee aanvalsvormen open:
--
--   1. Brute force op /api/auth/verify-pin. Pincodes zijn kort; zonder teller
--      kan een bot de hele ruimte binnen minuten aflopen.
--   2. Massale probing: /api/leads/<id>, /api/quotes/<id>, /api/track/<hash> en
--      /api/public/quotes/<hash> in bulk aflopen om geldige id's/hashes te vinden.
--
-- In-memory tellers zijn op Vercel niet genoeg: elke serverless-instantie heeft
-- zijn eigen geheugen, dus een aanvaller die verbindingen spreidt ontsnapt.
-- Deze migratie zet daarom de duurzame teller in Postgres, met atomaire upserts
-- zodat gelijktijdige requests niet langs elkaar heen tellen.
--
-- Idempotent: veilig meerdere keren te draaien.

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

-- Vaste-venster tellers. Eén rij per bucket ("beleid:identifier"), zodat de
-- upsert altijd op precies één rij lockt en gelijktijdige requests serialiseren.
create table if not exists public.rate_limit_counters (
  bucket_key        text primary key,
  hits              integer not null default 0,
  window_started_at timestamptz not null default now(),
  window_seconds    integer not null,
  expires_at        timestamptz not null,
  updated_at        timestamptz not null default now()
);

create index if not exists rate_limit_counters_expires_at_idx
  on public.rate_limit_counters (expires_at);

-- Tijdelijke blokkades. Losgekoppeld van de tellers omdat een blokkade langer
-- moet duren dan het venster waarin hij is verdiend, en omdat herhaald gedrag
-- via `strikes` progressief zwaarder bestraft wordt.
create table if not exists public.rate_limit_blocks (
  block_key     text primary key,
  scope         text,
  reason        text,
  strikes       integer not null default 1,
  blocked_until timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists rate_limit_blocks_blocked_until_idx
  on public.rate_limit_blocks (blocked_until);

-- Auditspoor van geweigerd verkeer. Bewust mét ruw IP: bij misbruik moet je het
-- adres kunnen doorzetten naar Vercel/Cloudflare. Retentie via prune-functie
-- onderaan (30 dagen).
create table if not exists public.api_abuse_events (
  id          uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  scope       text not null,
  policy      text,
  reason      text,
  path        text,
  method      text,
  tenant      text,
  identifier  text,
  ip_address  text,
  user_agent  text,
  details     jsonb
);

create index if not exists api_abuse_events_occurred_at_idx
  on public.api_abuse_events (occurred_at desc);

create index if not exists api_abuse_events_scope_idx
  on public.api_abuse_events (scope, occurred_at desc);

create index if not exists api_abuse_events_ip_idx
  on public.api_abuse_events (ip_address, occurred_at desc);

-- ---------------------------------------------------------------------------
-- RLS: server-managed, net als in migratie 022. Alleen de service-role client
-- (die RLS omzeilt) raakt deze tabellen aan; anon/authenticated krijgen bewust
-- geen policies.
-- ---------------------------------------------------------------------------

alter table public.rate_limit_counters enable row level security;
alter table public.rate_limit_blocks   enable row level security;
alter table public.api_abuse_events    enable row level security;

revoke all on public.rate_limit_counters from anon, authenticated;
revoke all on public.rate_limit_blocks   from anon, authenticated;
revoke all on public.api_abuse_events    from anon, authenticated;

-- ---------------------------------------------------------------------------
-- consume_rate_limit: telt één poging af tegen een vast venster.
--
-- De hele beslissing (venster verlopen? teller ophogen? over de limiet?) zit in
-- één statement. Een read-modify-write vanuit de app zou onder gelijktijdige
-- requests te laag tellen — precies het geval dat een brute-forcer opzoekt.
-- ---------------------------------------------------------------------------

create or replace function public.consume_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer,
  p_cost           integer default 1
)
returns table (
  allowed      boolean,
  hits         integer,
  remaining    integer,
  retry_after  integer,
  window_reset timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits    integer;
  v_expires timestamptz;
begin
  insert into public.rate_limit_counters as c
    (bucket_key, hits, window_started_at, window_seconds, expires_at, updated_at)
  values
    (p_key, greatest(p_cost, 0), now(), p_window_seconds,
     now() + make_interval(secs => p_window_seconds), now())
  on conflict (bucket_key) do update
    set hits = case
                 when c.expires_at <= now() then greatest(p_cost, 0)
                 else c.hits + greatest(p_cost, 0)
               end,
        window_started_at = case
                              when c.expires_at <= now() then now()
                              else c.window_started_at
                            end,
        expires_at = case
                       when c.expires_at <= now()
                         then now() + make_interval(secs => p_window_seconds)
                       else c.expires_at
                     end,
        window_seconds = p_window_seconds,
        updated_at = now()
  returning c.hits, c.expires_at into v_hits, v_expires;

  return query
  select
    v_hits <= p_limit,
    v_hits,
    greatest(p_limit - v_hits, 0),
    case
      when v_hits <= p_limit then 0
      else greatest(ceil(extract(epoch from (v_expires - now())))::integer, 1)
    end,
    v_expires;
end;
$$;

-- ---------------------------------------------------------------------------
-- peek_rate_limit: leest een teller zonder hem op te hogen. Nodig wanneer een
-- route pas ná afloop weet of de poging "duur" was (bv. een mislukte pincode).
-- ---------------------------------------------------------------------------

create or replace function public.peek_rate_limit(
  p_key   text,
  p_limit integer
)
returns table (
  allowed      boolean,
  hits         integer,
  remaining    integer,
  retry_after  integer,
  window_reset timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(c.hits, 0) <= p_limit,
    coalesce(c.hits, 0),
    greatest(p_limit - coalesce(c.hits, 0), 0),
    case
      when c.expires_at is null or coalesce(c.hits, 0) <= p_limit then 0
      else greatest(ceil(extract(epoch from (c.expires_at - now())))::integer, 1)
    end,
    c.expires_at
  from (select 1) s
  left join public.rate_limit_counters c
    on c.bucket_key = p_key and c.expires_at > now();
$$;

-- ---------------------------------------------------------------------------
-- reset_rate_limit: wist tellers, bv. na een geslaagde login. Zonder dit zou
-- een gebruiker die één keer verkeerd typt de rest van het venster blijven
-- meetellen richting een lockout.
-- ---------------------------------------------------------------------------

create or replace function public.reset_rate_limit(p_keys text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limit_counters where bucket_key = any(p_keys);
  get diagnostics v_deleted = row_count;
  delete from public.rate_limit_blocks where block_key = any(p_keys);
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- register_rate_limit_block: zet (of verlengt) een blokkade. Herhaling telt op
-- via `strikes`, met exponentiële duur tot een plafond van 24 uur — zo kost een
-- volhardende bot steeds meer, terwijl een gebruiker die zich één keer vergist
-- na de basisduur weer verder kan.
-- ---------------------------------------------------------------------------

create or replace function public.register_rate_limit_block(
  p_key     text,
  p_seconds integer,
  p_reason  text default null,
  p_scope   text default null
)
returns table (
  blocked_until timestamptz,
  strikes       integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_strikes  integer;
  v_until    timestamptz;
  v_duration integer;
begin
  select case when b.blocked_until > now() - interval '24 hours'
              then b.strikes + 1 else 1 end
    into v_strikes
  from public.rate_limit_blocks b
  where b.block_key = p_key;

  v_strikes := coalesce(v_strikes, 1);
  -- 1x = basis, 2x = dubbel, 3x = viervoud, ... afgetopt op 24 uur.
  v_duration := least(p_seconds * power(2, least(v_strikes - 1, 6))::integer, 86400);
  v_until := now() + make_interval(secs => v_duration);

  insert into public.rate_limit_blocks as b
    (block_key, scope, reason, strikes, blocked_until, created_at, updated_at)
  values
    (p_key, p_scope, p_reason, v_strikes, v_until, now(), now())
  on conflict (block_key) do update
    set scope = coalesce(excluded.scope, b.scope),
        reason = coalesce(excluded.reason, b.reason),
        strikes = excluded.strikes,
        blocked_until = greatest(b.blocked_until, excluded.blocked_until),
        updated_at = now()
  returning b.blocked_until, b.strikes into v_until, v_strikes;

  return query select v_until, v_strikes;
end;
$$;

-- ---------------------------------------------------------------------------
-- rate_limit_block_status: actieve blokkade opvragen.
-- ---------------------------------------------------------------------------

create or replace function public.rate_limit_block_status(p_key text)
returns table (
  blocked     boolean,
  retry_after integer,
  reason      text,
  strikes     integer
)
language sql
security definer
set search_path = public
as $$
  select
    true,
    greatest(ceil(extract(epoch from (b.blocked_until - now())))::integer, 1),
    b.reason,
    b.strikes
  from public.rate_limit_blocks b
  where b.block_key = p_key
    and b.blocked_until > now();
$$;

-- ---------------------------------------------------------------------------
-- prune_rate_limit_state: housekeeping. Verlopen tellers/blokkades weg, en
-- abuse-events ouder dan 30 dagen (bevatten IP-adressen — niet langer bewaren
-- dan nodig om misbruik te onderzoeken).
-- ---------------------------------------------------------------------------

create or replace function public.prune_rate_limit_state()
returns table (
  counters_removed integer,
  blocks_removed   integer,
  events_removed   integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counters integer;
  v_blocks   integer;
  v_events   integer;
begin
  delete from public.rate_limit_counters where expires_at <= now() - interval '1 hour';
  get diagnostics v_counters = row_count;

  delete from public.rate_limit_blocks where blocked_until <= now() - interval '24 hours';
  get diagnostics v_blocks = row_count;

  delete from public.api_abuse_events where occurred_at < now() - interval '30 days';
  get diagnostics v_events = row_count;

  return query select v_counters, v_blocks, v_events;
end;
$$;

-- Alleen de service-role client mag deze functies aanroepen.
revoke all on function public.consume_rate_limit(text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.peek_rate_limit(text, integer) from public, anon, authenticated;
revoke all on function public.reset_rate_limit(text[]) from public, anon, authenticated;
revoke all on function public.register_rate_limit_block(text, integer, text, text) from public, anon, authenticated;
revoke all on function public.rate_limit_block_status(text) from public, anon, authenticated;
revoke all on function public.prune_rate_limit_state() from public, anon, authenticated;

grant execute on function public.consume_rate_limit(text, integer, integer, integer) to service_role;
grant execute on function public.peek_rate_limit(text, integer) to service_role;
grant execute on function public.reset_rate_limit(text[]) to service_role;
grant execute on function public.register_rate_limit_block(text, integer, text, text) to service_role;
grant execute on function public.rate_limit_block_status(text) to service_role;
grant execute on function public.prune_rate_limit_state() to service_role;
