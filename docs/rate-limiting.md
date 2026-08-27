# Rate limiting & anti-abuse

Wat er nu op de API-endpoints van het CRM staat, waarom het zo is opgezet, en
hoe je het uitrolt en controleert.

## Aanleiding

Vóór deze wijziging was er één limiet in de hele applicatie: de publieke intake
telde maximaal vijf inzendingen per uur per e-mailadres. Daarmee stonden twee
dingen open:

- **Brute force op de pincode.** `/api/auth/verify-pin` had geen enkele teller.
  De pincode is 4 tot 6 cijfers, dus een bot loopt die ruimte binnen minuten af.
- **Massale probing.** Elk beschermd endpoint gaf netjes een 401 terug, maar
  niets hield bij hoe vaak iemand dat kreeg. Ook publieke schrijfpaden
  (`/api/public/quotes/<hash>/accept`, `/api/track/<hash>`) waren onbeperkt af te
  lopen, en de per-e-mailteller op de intake was te omzeilen door per inzending
  een nieuw adres te verzinnen.

## Twee lagen

| | Laag 1 — edge | Laag 2 — routes |
|---|---|---|
| Waar | `middleware.js` + `lib/rate-limit-edge.js` | `lib/rate-limit.js` |
| Opslag | geheugen van de serverless-instantie | Postgres (migratie 030) |
| Kosten | nul extra round-trips | één RPC per beschermde aanroep |
| Vangt | bursts en scanners | verspreide, langzame aanvallen |

De edge-laag draait vóór elke `/api/*`-request. Een database-round-trip per
request zou daar tientallen milliseconden kosten aan verkeer dat vrijwel altijd
legitiem is, dus die laag telt alleen in het geheugen. Nadeel: op Vercel heeft
elke instantie zijn eigen geheugen, dus een aanvaller die verbindingen spreidt
krijgt per instantie een verse teller.

Daarom telt voor de endpoints waar één geslaagde poging al schade oplevert —
pincode, cron-secret, offerte-hashes, AI- en mailacties — Postgres mee. De
tellers worden opgehoogd met een atomaire upsert (`consume_rate_limit`), zodat
gelijktijdige requests niet langs elkaar heen tellen.

**Faalgedrag:** als Supabase onbereikbaar is valt laag 2 terug op de in-memory
teller van de instantie en logt dat naar de console (`degraded: true`). Liever
iets te soepel meten dan de login platleggen omdat de tellertabel hapert.

## Wat waar geldt

Beleid staat op één plek: `RATE_LIMIT_POLICIES` in `lib/rate-limit.js`.

| Beleid | Limiet | Waar |
|---|---|---|
| `auth-pin-ip` | 20 / 5 min, daarna 15 min blok | `/api/auth/verify-pin` |
| `auth-pin-user` | 5 mislukte pogingen / 15 min, daarna 15 min lockout | `/api/auth/verify-pin` |
| `auth-directory` | 60 / 5 min | `/api/auth/users`, `/api/auth/organizations` |
| `public-intake-ip` | 10 / uur, daarna 1 uur blok | `/api/public/form-submit`, `/api/public/chatbot-intake` |
| `public-hash` | 120 / 10 min | `/api/track/<hash>`, `/api/public/quotes/<hash>/accept` |
| `public-hash-miss` | 12 missers / 10 min, daarna 1 uur blok | idem |
| `cron-secret-miss` | 5 misgokken / uur, daarna 1 uur blok | `/api/poll-inbox`, `/api/cron/*` |
| `session-search` | 90 / min per gebruiker | `/api/search` |
| `session-expensive` | 20 / 5 min per gebruiker | AI-routes en alles wat e-mail verstuurt |

In de middleware (laag 1), per IP:

| Bucket | Limiet |
|---|---|
| `burst` | 60 / 10 s |
| `sustained` | 600 / 5 min |
| `auth` | 40 / min op `/api/auth/*` |
| `public` | 90 / min op publieke paden |
| `probe` | 20 requests zonder geldige sessie / 10 min, daarna 30 min blok |
| `webhook` | 6000 / min op `/api/newsletter/webhook`, geen strafblokkade |

De ondertekende Resend-webhook heeft een eigen emmer en telt niet mee in
`burst`/`sustained`. Zijn authenticatie is de Svix-handtekening, niet het IP, en
één nieuwsbriefbatch (100 ontvangers) levert honderden events kort na elkaar —
dat gaat legitiem over een emmer die op browserverkeer is gedimensioneerd. Een
verloren bounce- of klachtevent betekent dat we opnieuw mailen naar een adres
dat al hard gebounced is, dus daar is een 429 duurder dan het risico. Volledig
vrijstellen doen we niet: een request met een ongeldige handtekening kost een
query op `newsletter_settings` vóórdat hij wordt afgekeurd.

Plus 900 requests per minuut per ingelogde gebruiker — een gestolen cookie die
achter wisselende adressen wordt gebruikt loopt anders langs elke IP-teller heen.

Blokkades zijn progressief: herhaling verdubbelt de duur (`strikes`), afgetopt op
24 uur in de database en 6 uur in het geheugen.

**`limit` betekent twee dingen, afhankelijk van de aanroep.** Bij
`enforceRateLimit` is het het aantal toegestane requests: bij 20 mag de
twintigste er nog door en wordt de eenentwintigste geweigerd. Bij
`registerFailedAttempt` is het het aantal mislukte pogingen dat een lockout
zet: bij 5 is het account ná de vijfde misser op slot. Wie dat door elkaar
haalt, geeft er precies één poging te veel weg.

Een geslaagde login wist de faalteller van dat account, zodat één typefout niet
meetelt richting de lockout van morgen. De IP-teller blijft dan bewust staan:
die telt élke verificatiepoging en is het enige plafond op het totale volume
vanaf één bron. Zou je hem óók wissen, dan krijgt iemand die één pincode kent
een gratis reset — negentien gokken op andere accounts, dan inloggen op het
eigen account, en de teller staat weer op nul.

## Wat er verder is gewijzigd

- **Constante-tijd vergelijking** voor de pincode-hash en het cron-secret. Een
  gewone `===` lekt via de responsetijd hoe ver een gok naast zat.
- **Formaatvalidatie vóór de database-query** op pincodes, org-id's en
  offerte-hashes. Een gok in het verkeerde formaat kan nooit kloppen en kost nu
  geen query meer.
- **Server-only headers worden altijd gestript.** De middleware zette
  `x-auth-*` alleen op beschermde paden en verwijderde ze nergens; op publieke
  paden kon een client ze dus zelf meesturen. Nu worden ze bij elke request eerst
  verwijderd en pas daarna door de middleware gezet.
- **Gelijke foutmelding** voor "gebruiker bestaat niet" en "pincode klopt niet".
- **`api_abuse_events`** legt geweigerd verkeer vast, mét IP zodat je het adres
  kunt doorzetten naar Vercel. Retentie 30 dagen.

## Uitrol

De migratie is puur additief: drie nieuwe tabellen en zes nieuwe functies, geen
wijziging aan bestaande objecten. Hij kan dus vóór de deploy, en dat heeft de
voorkeur — andersom draait de app een tijd met een RPC die nog niet bestaat.

1. Draai `migrations/030_rate_limiting_and_abuse.sql` op het CRM
   Supabase-project. Idempotent, dus opnieuw draaien kan geen kwaad.
2. Controleer:

```bash
npm run check:rate-limit
```

   De check moet `ok: true` teruggeven. Verwacht: 3 tabellen met RLS aan, 6
   `security definer` functies, en `public_execute_grants: 0`.
3. Deploy de app.

> Stand op 2026-08-27: stap 1 en 2 zijn uitgevoerd op project
> `olzyffwotjtyvupomoiz` (`ok: true`). De code staat nog op de branch, dus er
> verwijst nog niets naar deze tabellen en ze blijven leeg tot de deploy.

Zolang de migratie niet gedraaid is faalt elke RPC en valt de app terug op de
in-memory teller. Dat werkt, maar de bescherming tegen verspreide brute force
is er dan niet — en dat is alleen zichtbaar in de Vercel-logs, niet in het
gedrag van de app.

## Optionele instelling

`RATE_LIMIT_SALT` — pepert de gehashte identifiers in `rate_limit_counters`.
Valt terug op `JWT_SECRET`. Wijzigen wist in de praktijk alle lopende tellers
(alle sleutels veranderen), dus doe dat niet tijdens een aanval.

## Onderhoud

`prune_rate_limit_state()` ruimt verlopen tellers, blokkades en abuse-events
ouder dan 30 dagen op. Er is geen aparte cron voor: ongeveer één op de duizend
beschermde requests draait de prune op de achtergrond. De tabellen groeien per
unieke identifier, niet per request, dus dat is ruim genoeg. Handmatig kan ook:

```sql
select * from prune_rate_limit_state();
```

## Onderzoek na een incident

```sql
-- Wat is er de afgelopen dag geweigerd, en vanaf welk adres?
select occurred_at, scope, policy, reason, ip_address, user_agent
from api_abuse_events
where occurred_at > now() - interval '24 hours'
order by occurred_at desc
limit 100;

-- Welke adressen staan nu buiten, en hoe vaak zijn ze al teruggekomen?
select block_key, scope, reason, strikes, blocked_until
from rate_limit_blocks
where blocked_until > now()
order by strikes desc;

-- Een blokkade opheffen (bijvoorbeeld een collega achter kantoor-NAT).
-- De sleutel staat in rate_limit_blocks; het IP zelf staat er bewust niet in,
-- dus zoek de bijbehorende gebeurtenis in api_abuse_events op tijdstip.
select reset_rate_limit(array['<block_key>']);
```

## Bekende beperking

De pincode-hash is een ongesalte SHA-256. Dat is met deze limieten niet online
te brute-forcen, maar wie de `users`-tabel in handen krijgt heeft aan een
rainbow table genoeg. Een sterkere hash (bcrypt/argon2) vraagt om het opnieuw
instellen van alle pincodes en valt buiten deze wijziging.

Pagina-routes (`/offerte/<hash>`) vallen buiten de middleware — die matcht op
`/api/:path*`. De bijbehorende schrijfactie (`/api/public/quotes/<hash>/accept`)
is wél begrensd.
