# Security fix — Supabase RLS lockdown (branch `security/supabase-rls-lockdown`)

## Het probleem
De volledige `public`-schema van het Supabase-project `487crm` (`olzyffwotjtyvupomoiz`)
was lees- én schrijfbaar via de **anon-key**:
- 12 tabellen zonder RLS (o.a. `quote_line_items`, `quote_emails`, `email_templates`, `hiphot_*`, `form_submissions`, `organizations`);
- de overige CRM-tabellen met een wijd-open policy: role `public`, cmd `ALL`, `USING (true)`.

De anon-key is een **`NEXT_PUBLIC_`** (publieke) credential. De app draait alle
DB-toegang server-side achter JWT-auth, dus er is nu géén bekende open deur — maar de
database zelf heeft **geen enkele bescherming**: lekt de anon-key via één kanaal, dan
heeft iedereen volledige lees/schrijf-toegang tot alle CRM- én HipHot-data, buiten de
app om (PostgREST is publiek bereikbaar).

Daarnaast viel `JWT_SECRET` in `lib/auth.js` terug op de anon-key — een publieke
sleutel als ondertekening voor sessie-tokens.

## Wat deze branch wijzigt (code)
| Bestand | Wijziging |
|---|---|
| `lib/supabase.js` | anon-key → **`SUPABASE_SERVICE_ROLE_KEY`** (server-only client + `window`-guard). |
| `app/offerte/[hash]/page.jsx` | idem (server component). |
| `lib/auth.js` | `JWT_SECRET`-fallback naar de anon-key **verwijderd** (fail-closed). |
| `migrations/013_lock_down_public_rls.sql` | RLS aan op de 12 tabellen + open `using(true)`-policies droppen. |

Alle Supabase-toegang loopt al server-side via één chokepoint (`lib/supabase.js`,
gebruikt door ~40 API-routes) + de offerte-server-component. Geen client-component
gebruikt Supabase, dus de service_role-key komt **niet** in de browser.

## Vereisten vóór deploy
1. **`SUPABASE_SERVICE_ROLE_KEY`** toevoegen in Vercel (en lokaal in `.env.local`).
   Te vinden in Supabase → project `487crm` → Project Settings → API → `service_role`.
2. **`JWT_SECRET`** moet in Vercel gezet zijn (staat al lokaal). Door het verwijderen
   van de fallback faalt auth bewust als deze ontbreekt. Zet 'm vóór deploy.
   > Let op: als de huidige productie-`JWT_SECRET` afweek van wat lokaal staat,
   > worden bestaande sessies ongeldig → iedereen logt één keer opnieuw in.

## Volgorde van uitrol (belangrijk!)
1. **Deploy de code-branch naar STAGING.** Test: inloggen, leads/quotes/contacten
   lezen+bewerken, publieke offerte-pagina (`/offerte/<hash>`), offerte accepteren,
   form-submit (`/api/public/form-submit`), HipHot-flows. Alles moet werken via
   service_role.
2. **Merge → deploy naar PRODUCTIE.** Nu gebruikt de CRM service_role; de anon-key
   wordt nergens meer gebruikt.
3. **Verifieer `487crm-mcp`** (de MCP-server): de env `CRM487_SUPABASE_KEY` moet de
   **service_role**-key zijn, niet de anon-key. Zo niet → eerst omzetten, anders
   breken de `mcp__48-7_CRM__crm_*` tools bij stap 4.
4. **Draai `migrations/013_lock_down_public_rls.sql`** op het productie-project
   (Supabase SQL editor of MCP `apply_migration`). Vanaf nu krijgt de anon-key nul
   toegang.
5. **Roteer/deactiveer de legacy anon-key** in Supabase → API Keys. Veilig want alle
   consumers gebruiken dan service_role:
   - CRM-webapp ✓ (deze branch) · intake-app ✓ (gebruikt al service_role) ·
     screen-to-workflow ✓ (service_role) · 487crm-mcp ✓ (na stap 3).

> Stap 1-2 (code) MOETEN vóór stap 4 (migratie). Andersom breekt de CRM.

## Geverifieerd vs. nog te testen
- **Geverifieerd door mij:** geen enkele client-component gebruikt Supabase/de anon-key;
  het toegangspatroon (open policies + RLS-uit) via `pg_policies`; de migratie is
  geschreven tegen de exacte huidige policy-namen; JS-syntax van de gewijzigde files.
- **Door jullie te testen (heeft de service_role-key + jullie deploy nodig):**
  staging-deploy + de flows uit stap 1, daarna de migratie + een rooktest met de
  anon-key (moet ná de migratie `permission denied` / leeg geven).

## Rollback
- Code: branch niet mergen / revert de commit.
- DB: zie de ROLLBACK-noot onderaan `migrations/013_lock_down_public_rls.sql`
  (policy tijdelijk heropenen of RLS per tabel uitzetten).

## Niet in scope (los opvolgen)
- `scripts/import-zonvenant.mjs` heeft nog een anon-fallback — onschuldig (handmatig
  script), maar draai 't met `SUPABASE_SERVICE_ROLE_KEY` na de lockdown.
- De CRM-repo staat in iCloud (`~/Documents/Dev/487crm`) — buiten scope hier.
