# HubSpot naar HipHot CRM import

Deze import is alleen bedoeld voor de HipHot tenant (`hiphot`). Het script heeft geen tenant-argument en kan daardoor niet per ongeluk naar `48-7` schrijven.

Zie ook het volledige migratie-draaiboek in `docs/hiphot-hubspot-migration-runbook.md`.
Voor het verzamelen van de HubSpot-bestanden staat er een praktische checklist in `docs/hiphot-hubspot-export-checklist.md`.

## Benodigde HubSpot exports

Exporteer uit HubSpot minimaal:

1. **Companies / Bedrijven**
   - Record ID / Company ID
   - Company name
   - Domain / website
   - Phone
   - Street address
   - Postal code
   - City
   - Country
   - Industry
   - Lifecycle stage / lead status, als beschikbaar

2. **Contacts / Contactpersonen**
   - Record ID / Contact ID
   - Associated Company ID
   - Company name
   - Email
   - First name
   - Last name
   - Phone / mobile phone
   - Job title
   - Marketing contact status
   - Email subscription status
   - Opted out / unsubscribe properties
   - Email hard bounce reason
   - List memberships, tags of segment-kolommen

3. **Nieuwsbriefsegmenten**
   - Factor 30
   - Factor 50
   - Algemene nieuwsbrief / marketingmail
   - Event/recreatie, outdoor werk, klant/prospect alleen als deze echt in HubSpot bestaan

4. **Deals / verkoopkansen** (optioneel, maar nodig voor volledige historie)
   - Record ID / Deal ID
   - Deal name
   - Associated Company ID
   - Company name
   - Amount
   - Deal stage
   - Pipeline
   - Close date
   - Deal owner

5. **Notes / notities** (optioneel, maar nodig voor volledige historie)
   - Record ID / Note ID
   - Associated Company ID
   - Company name
   - Associated Contact Email
   - Note body
   - Create date / activity date
   - Note owner / created by

Als HubSpot lijstlidmaatschappen niet in de contact-export zitten, exporteer de relevante lijsten apart en voeg ze als kolommen toe aan het contactbestand voordat de import draait.

Je kunt losse lijstexports ook apart meegeven. Zet de bestanden bijvoorbeeld in één map met herkenbare namen:

```text
hubspot-lijsten/
  Factor 30.csv
  Factor 50.csv
  Algemene nieuwsbrief.csv
```

Of geef per bestand expliciet aan welk CRM-segment het is:

```bash
--list=factor_30:/pad/naar/factor-30.csv
--list=factor_50:/pad/naar/factor-50.csv
--list=algemene_nieuwsbrief:/pad/naar/algemene-nieuwsbrief.csv
```

De lijstexports mogen minimaal een e-mailadres, HubSpot Contact ID of Associated Company ID bevatten. Als dezelfde contactpersoon ook in de gewone contact-export zit, worden de gegevens samengevoegd.

## API-export uit HubSpot

Als er een HubSpot Private App token beschikbaar is, kunnen de bestanden ook read-only via de API worden gemaakt:

```bash
HUBSPOT_ACCESS_TOKEN=... npm run export:hubspot:hiphot -- \
  --out=/tmp/hiphot-hubspot-api-export
```

Daarna staat in `/tmp/hiphot-hubspot-api-export/manifest.json` het exacte dry-run importcommando.

De API-exporter haalt Factor 30 en Factor 50 uit de HubSpot lijsten `SPF30 kopers NL` en `SPF50 kopers NL`. Het segment Algemene nieuwsbrief wordt afgeleid uit de officiële subscription status `Marketing Information: SUBSCRIBED`, zodat er geen onduidelijke algemene lijstnaam hoeft te worden gegokt.

Deals en notities die in HubSpot niet direct aan een bedrijf hangen, maar wel aan een contactpersoon, krijgen via die contactpersoon alsnog `Associated Company ID`, `Company name` en `Associated Contact Email` in de export. Daardoor kan de import meer historie onder het juiste CRM-bedrijf plaatsen.

De import gebruikt HubSpot deals ook om de HipHot pipelinefase te bepalen. Bedrijven zonder bruikbare dealhistorie starten als `Geen lead`; bedrijven met order- of offertehistorie komen in de passende CRM-kolom:

| HubSpot pipeline | HubSpot stadium | HipHot CRM pipelinefase |
| --- | --- | --- |
| Ecommerce | Checkout Abandoned | Prospect |
| Ecommerce | Payment Pending/Failed | In Overweging |
| Ecommerce | On hold | In de Wacht |
| Ecommerce | Processing | Gewonnen |
| Ecommerce | Completed | Gewonnen |
| Ecommerce | Refunded/Cancelled | Verloren |
| Offertes | Nieuwe aanvraag | Nieuwe Aanvraag |
| Offertes | Offerte verstuurd | Offerte Gestuurd |
| Offertes | Reminder gestuurd | Reminder Gestuurd |
| Offertes | In de wacht | In de Wacht |
| Offertes | In overweging | In Overweging |
| Offertes | Offerte gewonnen | Gewonnen |
| Offertes | Offerte verloren | Verloren |

Bestaande CRM-leads behouden hun huidige pipelinefase, behalve wanneer ze nog `Prospect` zijn en HubSpot een duidelijkere fase heeft. Dat voorkomt dat actuele CRM-opvolging door oude HubSpot-data wordt overschreven.

Benodigde HubSpot scopes voor een volledige API-export:

- CRM objecten: bedrijven, contacten, deals en notities lezen.
- Associations lezen, zodat contacten/deals/notities aan bedrijven gekoppeld worden.
- `crm.lists.read` voor Factor 30, Factor 50 en Algemene nieuwsbrief.
- `communication_preferences.read` voor de officiële e-mail subscription status. Als `communication_preferences.statuses.batch.read` beschikbaar is gebruikt de exporter de nieuwere batchroute; anders valt hij terug op de v3-statusroute per e-mailadres.

Zonder lijst- of communicatievoorkeur-scope maakt de exporter wel bedrijven/contacten/deals/notities, maar geeft hij waarschuwingen voor marketinglijsten en nieuwsbriefstatussen.

## CRM readiness-check

Draai vóór de CRM dry-run een read-only check op de CRM-database:

```bash
npm run readiness:hubspot:hiphot -- \
  --report=/tmp/hiphot-hubspot-readiness.json \
  --report-md=/tmp/hiphot-hubspot-readiness.md
```

Deze check schrijft niets. Hij controleert of de benodigde migratievelden aanwezig zijn op `leads` en `contacts`, inclusief `relationship_type`, en of er geen HubSpot-markeringen buiten tenant `hiphot` staan. Voor volledige tenantcontrole en live import moet `SUPABASE_SERVICE_ROLE_KEY` beschikbaar zijn; met alleen de publieke sleutel is de controle beperkt door database-rechten.

Als deze check meldt dat **Relatietype** ontbreekt, pas eerst `migrations/015_hiphot_relationship_type.sql` toe. Live import stopt ook zelf als die kolom nog ontbreekt.

## Dry-run

Doe eerst een export-audit. Die kijkt alleen naar de HubSpot-bestanden zelf en heeft geen CRM-toegang nodig:

```bash
node scripts/import-hubspot-hiphot.mjs \
  --companies=/pad/naar/hubspot-companies.xlsx \
  --contacts=/pad/naar/hubspot-contacts.xlsx \
  --deals=/pad/naar/hubspot-deals.xlsx \
  --notes=/pad/naar/hubspot-notes.xlsx \
  --lists=/pad/naar/hubspot-lijsten \
  --report=/tmp/hiphot-hubspot-export-audit.json \
  --report-md=/tmp/hiphot-hubspot-export-audit.md \
  --audit
```

Controleer in dit auditrapport vooral:

- welke marketingkolommen HubSpot heeft meegegeven
- of Factor 30 en Factor 50 herkend worden
- welke segmentwaarden mogelijk nog geen mapping hebben
- of de benodigde bedrijf/contact-kolommen aanwezig zijn

Als de segmentnamen kloppen, draai daarna de CRM dry-run:

```bash
node scripts/import-hubspot-hiphot.mjs \
  --companies=/pad/naar/hubspot-companies.xlsx \
  --contacts=/pad/naar/hubspot-contacts.xlsx \
  --deals=/pad/naar/hubspot-deals.xlsx \
  --notes=/pad/naar/hubspot-notes.xlsx \
  --lists=/pad/naar/hubspot-lijsten \
  --report=/tmp/hiphot-hubspot-import-dry-run.json \
  --report-md=/tmp/hiphot-hubspot-import-dry-run.md
```

Dit schrijft niets naar CRM. Controleer daarna vooral het `.md` rapport:

- aantal nieuwe bedrijven
- aantal bestaande bedrijven dat bijgewerkt wordt
- aantal contactpersonen
- aantal bedrijven met marketing toegestaan
- Factor 30 en Factor 50 aantallen
- aantal HubSpot deals en notities dat gekoppeld wordt
- HubSpot deals per bronpipeline: Ecommerce en Offertes
- relatietype-aantallen
- niet-gekoppelde deals/notities die handmatig bekeken moeten worden
- waarschuwingen over onbekende marketingstatussen of niet-herkende segmenten
- of de relatietype-kolom in de huidige CRM-database ontbreekt

## Live import

Alleen uitvoeren na controle van de dry-run:

```bash
node scripts/import-hubspot-hiphot.mjs \
  --companies=/pad/naar/hubspot-companies.xlsx \
  --contacts=/pad/naar/hubspot-contacts.xlsx \
  --deals=/pad/naar/hubspot-deals.xlsx \
  --notes=/pad/naar/hubspot-notes.xlsx \
  --lists=/pad/naar/hubspot-lijsten \
  --approved-report=/tmp/hiphot-hubspot-import-dry-run.json \
  --report=/tmp/hiphot-hubspot-import-result.json \
  --report-md=/tmp/hiphot-hubspot-import-result.md \
  --commit
```

Live import vereist `--approved-report` met een eerder gecontroleerd dry-run rapport. Als de huidige importplanning daarvan afwijkt, stopt het script zonder te schrijven. Die controle kijkt ook naar gedrag dat bestaande CRM-data kan wijzigen, zoals `--overwrite`, en naar een vaste vingerafdruk plus payloadoverzicht van alle geplande lead-, contact-, notitie- en activiteitwijzigingen.

Live import stopt ook vroeg als de CRM-databasekolom `relationship_type` nog ontbreekt of als `SUPABASE_SERVICE_ROLE_KEY` niet beschikbaar is.

Standaard vult de import bestaande CRM-velden alleen aan als ze leeg zijn. Marketingvelden, HubSpot ID's en importmetadata worden wel bijgewerkt. Gebruik `--overwrite` alleen als HubSpot bewust leidend moet zijn voor bestaande CRM-velden.

## Verificatie na import

Maak na de live import een post-import rapport:

```bash
npm run verify:hubspot:hiphot -- \
  --expected=/tmp/hiphot-hubspot-import-report.json \
  --report=/tmp/hiphot-hubspot-post-import-verification.json \
  --report-md=/tmp/hiphot-hubspot-post-import-verification.md
```

Dit rapport leest alleen tenant `hiphot` en controleert ook of er geen HubSpot-markeringen buiten HipHot zijn gevonden. Als een dry-run rapport als `--expected` wordt meegegeven, vergelijkt het verificatiescript ook de relatietype-aantallen met die goedgekeurde dry-run.

## Wat wordt waar opgeslagen?

- Bedrijven worden CRM-leads met `tenant='hiphot'`.
- Marketingtoestemming, segmenten en tags worden op bedrijfsniveau opgeslagen op de lead.
- Contactpersonen blijven contactpersonen onder het bedrijf.
- HubSpot deals en HubSpot notities worden als interne CRM-notities onder het bedrijf opgeslagen.
- HubSpot deal/notitie-notities krijgen een import-key om dubbele historie-notities bij een tweede run te voorkomen.
- HubSpot contact-ID's worden alleen gebruikt voor dedupe/audit, niet voor marketing op contactniveau.
- De ruwe geïmporteerde HubSpot-rijen worden als activiteit-metadata bewaard, zodat exportdata later terug te vinden is.
