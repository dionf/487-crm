# HubSpot naar HipHot CRM import

Deze import is alleen bedoeld voor de HipHot tenant (`hiphot`). Het script heeft geen tenant-argument en kan daardoor niet per ongeluk naar `48-7` schrijven.

Zie ook het volledige migratie-draaiboek in `docs/hiphot-hubspot-migration-runbook.md`.

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
- niet-gekoppelde deals/notities die handmatig bekeken moeten worden
- waarschuwingen over onbekende marketingstatussen of niet-herkende segmenten

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

Live import vereist `--approved-report` met een eerder gecontroleerd dry-run rapport. Als de huidige importplanning daarvan afwijkt, stopt het script zonder te schrijven.

Standaard vult de import bestaande CRM-velden alleen aan als ze leeg zijn. Marketingvelden, HubSpot ID's en importmetadata worden wel bijgewerkt. Gebruik `--overwrite` alleen als HubSpot bewust leidend moet zijn voor bestaande CRM-velden.

## Verificatie na import

Maak na de live import een post-import rapport:

```bash
npm run verify:hubspot:hiphot -- \
  --expected=/tmp/hiphot-hubspot-import-report.json \
  --report=/tmp/hiphot-hubspot-post-import-verification.json \
  --report-md=/tmp/hiphot-hubspot-post-import-verification.md
```

Dit rapport leest alleen tenant `hiphot` en controleert ook of er geen HubSpot-markeringen buiten HipHot zijn gevonden.

## Wat wordt waar opgeslagen?

- Bedrijven worden CRM-leads met `tenant='hiphot'`.
- Marketingtoestemming, segmenten en tags worden op bedrijfsniveau opgeslagen op de lead.
- Contactpersonen blijven contactpersonen onder het bedrijf.
- HubSpot deals en HubSpot notities worden als interne CRM-notities onder het bedrijf opgeslagen.
- HubSpot deal/notitie-notities krijgen een import-key om dubbele historie-notities bij een tweede run te voorkomen.
- HubSpot contact-ID's worden alleen gebruikt voor dedupe/audit, niet voor marketing op contactniveau.
- De ruwe geïmporteerde HubSpot-rijen worden als activiteit-metadata bewaard, zodat exportdata later terug te vinden is.
