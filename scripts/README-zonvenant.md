# Zonvenant Partners import

Een eenmalige import van de Zonvenant partners-lijst als HipHot leads met `source=zonvenant_partners`.

## Stap 1 — Repareer bestaande kinderopvang-leads

Open Supabase SQL-editor, paste `scripts/fix-zonvenant-industry.sql` — eerst het `SELECT` deel om te zien wat er bijgewerkt wordt. Als dat klopt, draai de `UPDATE`.

Dit fixt:
- `industry = "Kinderopvang"` (rauwe waarde) → `industry = "zorg"` (dropdown-id)
- `category = "Kinderopvang"` → `NULL` (dubbele waarde weg)
- `source` krijgt `zonvenant_partners` als die nog leeg was

## Stap 2 — Dry-run de import

```bash
cd /Users/dion/Documents/Dev/487crm
node scripts/import-zonvenant.mjs --dry-run
```

Dit toont zonder te schrijven:
- Hoeveel rijen met telefoonnummer
- Hoeveel uniek vs duplicate (op bestaande HipHot-leads)
- Hoeveel branche-mismatches (industry=null, raw waarde in de note)
- Voorbeeld-payload van de eerste 3 leads

## Stap 3 — Echt importeren

Als de dry-run output er goed uitziet:

```bash
node scripts/import-zonvenant.mjs --commit
```

Output: `N toegevoegd, M gefaald, K overgeslagen`.

## Wat het script doet per lead

1. **Dedup check** — skip als `(company_name + city)` al bestaat, of als e-mailadres al ergens binnen HipHot-tenant staat
2. **Insert `leads`** met:
   - `tenant='hiphot'`, `source='zonvenant_partners'`, `status='nieuwe_aanvraag'`
   - `company_name`, `email`, `phone`, `website_url`, `address`, `city`
   - `billing_street/postal_code/city` (geparst uit `Adres`)
   - `industry` (gemapt via `BRANCHE_TO_INDUSTRY`)
3. **Insert `notes`** (intern): herkomst + Hoofdcategorie + originele Branche + Opmerkingen
4. **Insert `activities`**: `lead_created` met beschrijving van herkomst

## Branche-mapping

| Excel-waarde | CRM industry |
|---|---|
| Kinderopvang, Ziekenhuis, Gezondheidszorg | `zorg` |
| School/Opleiding | `scholen` |
| Sport, Sportbond, Zwembad, Recreatie | `sport` |
| GGD, Gemeente | `overheid` |
| Horeca | `horeca` |
| Huidverzorging/Schoonheid | `dienstverlening` |
| Bedrijf, Non-profit, Beroepsvereniging, Rotary, Overig | `overig` |

Onbekende waarden → `industry = NULL`, ruwe waarde in de note met ⚠️.

## Veiligheid

- Script gebruikt `SUPABASE_SERVICE_ROLE_KEY` (als gezet) of `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Dedup is robuust genoeg dat het script **herhaald** gedraaid kan worden zonder duplicaten.
- Dry-run maakt geen writes.
- Dependencies: `xlsx` en `@supabase/supabase-js` — beide al in het project.

## Als je iets wil terugdraaien

Alle geïmporteerde leads zijn herkenbaar aan `source='zonvenant_partners'` én de aangemaakte `Zonvenant import`-note/activity. Om alles in één keer terug te rollen:

```sql
DELETE FROM leads
WHERE tenant = 'hiphot'
  AND source = 'zonvenant_partners'
  AND created_at > '2026-04-19';  -- pas aan naar je importdatum
```

(`notes` en `activities` worden via CASCADE meegenomen.)
