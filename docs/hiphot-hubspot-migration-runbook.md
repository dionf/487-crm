# HipHot HubSpot naar CRM migratie-runbook

Doel: alle relevante HubSpot-gegevens van HipHot veilig overzetten naar het eigen CRM op `crm.48-7.nl/hiphot`, zodat HubSpot daarna kan worden opgezegd.

Scope:

- Alleen tenant `hiphot`.
- Geen wijzigingen aan tenant `48-7`.
- Bedrijven zijn leidend voor marketing, segmentatie en tags.
- Contactpersonen blijven contactpersonen onder een bedrijf.
- Nieuwsbriefverzending via Resend is een latere fase en valt buiten deze import.

## Huidige CRM-voorbereiding

In CRM is al voorbereid:

- Marketingvelden op bedrijfsniveau:
  - nieuwsbrief toegestaan
  - segmenten/tags
  - abonnementsstatus
  - toestemming bron/datum
  - uitschrijfdatum
  - hard bounce als status/importsignaal
- HipHot-only UI voor `Marketing bedrijf`.
- HipHot-only filters voor marketing en segmenten.
- HubSpot IDs op bedrijf en contactpersoon voor dedupe en audit.
- Importtooling met audit, dry-run, readable report en expliciete `--commit`.

## HubSpot exports

Exporteer uit HubSpot deze bestanden, bij voorkeur als `.xlsx` of `.csv`.

Gebruik `docs/hiphot-hubspot-export-checklist.md` als praktische export-checklist met bestandsnamen, doelmap en minimale kolommen.

### Verplicht

1. Companies / Bedrijven
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

2. Contacts / Contactpersonen
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

3. Marketinglijsten / nieuwsbriefsegmenten
   - Factor 30
   - Factor 50
   - Algemene nieuwsbrief / marketingmail
   - Andere echte HubSpot-lijsten alleen meenemen nadat ze in het auditrapport zichtbaar zijn.

### Aanbevolen voor volledige historie

4. Deals / verkoopkansen
   - Record ID / Deal ID
   - Associated Company ID
   - Company name
   - Deal name
   - Amount
   - Deal stage
   - Pipeline
   - Close date
   - Deal owner

5. Notes / notities
   - Record ID / Note ID
   - Associated Company ID
   - Company name
   - Associated Contact Email
   - Note body
   - Create date / activity date
   - Note owner / created by

### Alternatief: API-export

Met een HubSpot Private App token kunnen dezelfde bestanden read-only via de API worden gemaakt:

```bash
HUBSPOT_ACCESS_TOKEN=... npm run export:hubspot:hiphot -- \
  --out=/tmp/hiphot-hubspot-api-export
```

De exporter schrijft `hubspot-companies.xlsx`, `hubspot-contacts.xlsx`, `hubspot-deals.xlsx`, `hubspot-notes.xlsx`, losse lijstbestanden voor productsegmenten en een `manifest.json` met het exacte dry-run importcommando. Het segment Algemene nieuwsbrief wordt afgeleid uit de officiële HubSpot subscription status.

Voor een volledige marketingexport moet de HubSpot app naast CRM-readrechten ook `crm.lists.read` en `communication_preferences.read` hebben. Als `communication_preferences.statuses.batch.read` beschikbaar is gebruikt de exporter de nieuwere batchroute; anders valt hij terug op de v3-statusroute per e-mailadres.

## Fase 1: export-audit

Doel: controleren of de HubSpot-bestanden de juiste kolommen en segmentnamen bevatten. Deze stap schrijft niets naar CRM en heeft geen CRM-database nodig.

Voorbeeld:

```bash
npm run import:hubspot:hiphot -- \
  --companies=/pad/naar/hubspot-companies.xlsx \
  --contacts=/pad/naar/hubspot-contacts.xlsx \
  --deals=/pad/naar/hubspot-deals.xlsx \
  --notes=/pad/naar/hubspot-notes.xlsx \
  --lists=/pad/naar/hubspot-lijsten \
  --report=/tmp/hiphot-hubspot-export-audit.json \
  --report-md=/tmp/hiphot-hubspot-export-audit.md \
  --audit
```

Go/no-go:

- Factor 30 wordt herkend.
- Factor 50 wordt herkend.
- Algemene nieuwsbrief / marketingmail wordt herkend.
- Losse lijstbestanden zonder segmentmapping zijn verklaard of expliciet gemapt.
- De bedrijven- en contactpersonenbestanden bevatten genoeg koppelvelden: Company ID, bedrijfsnaam, e-mailadres of domein.
- Deal- en notitiekolommen zijn aanwezig als historie wordt meegenomen.

## Fase 2: CRM dry-run

Doel: de HubSpot-export vergelijken met de bestaande HipHot CRM-data, zonder te schrijven.

Voorbeeld:

```bash
npm run import:hubspot:hiphot -- \
  --companies=/pad/naar/hubspot-companies.xlsx \
  --contacts=/pad/naar/hubspot-contacts.xlsx \
  --deals=/pad/naar/hubspot-deals.xlsx \
  --notes=/pad/naar/hubspot-notes.xlsx \
  --lists=/pad/naar/hubspot-lijsten \
  --report=/tmp/hiphot-hubspot-import-dry-run.json \
  --report-md=/tmp/hiphot-hubspot-import-dry-run.md
```

Controleer in het `.md` rapport:

- aantal nieuwe bedrijven
- aantal bestaande bedrijven dat wordt bijgewerkt
- aantal contactpersonen
- aantal bedrijven met marketing toegestaan
- aantallen voor Factor 30 en Factor 50
- aantal gekoppelde deals en notities
- aantal niet-gekoppelde deals en notities
- waarschuwingen over onbekende marketingstatussen of niet-herkende segmenten

Go/no-go:

- Geen onverwacht hoge aantallen nieuwe bedrijven.
- Geen onverwacht hoge aantallen niet-gekoppelde deals/notities.
- Marketingaantallen passen bij HubSpot.
- Factor 30 en Factor 50 aantallen passen bij HubSpot.
- Er is expliciet akkoord op het dry-run rapport voordat `--commit` wordt gebruikt.

## Fase 3: live import

Alleen uitvoeren na akkoord op de dry-run.

Voorbeeld:

```bash
npm run import:hubspot:hiphot -- \
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

Importgedrag:

- Nieuwe bedrijven worden CRM-leads met `tenant='hiphot'`.
- Bestaande bedrijven worden herkend via HubSpot company-ID, bedrijfsnaam+plaats of e-mail.
- Bestaande CRM-velden worden standaard alleen aangevuld als ze leeg zijn.
- Marketingvelden, HubSpot IDs en importmetadata worden bijgewerkt.
- Contactpersonen worden onder het bedrijf gezet.
- Marketingtoestemming en segmenten worden op bedrijfsniveau gezet, niet op contactniveau.
- HubSpot deals en notities worden als interne CRM-notities onder het bedrijf gezet.
- HubSpot deal/notitie-notities krijgen een import-key, zodat opnieuw draaien geen dubbele historie-notities hoort te maken.
- Ruwe HubSpot-rijen worden bewaard in activity metadata voor audit.
- Live import vereist `--approved-report` met een eerder dry-run rapport. Als de huidige planning, overwrite-modus of geplande schrijfdata afwijkt, stopt de import.

Gebruik `--overwrite` alleen als HubSpot bewust leidend moet zijn voor bestaande CRM-velden.

## Fase 4: validatie na import

Voer na de import minimaal deze controles uit:

Maak eerst het automatische post-import rapport:

```bash
npm run verify:hubspot:hiphot -- \
  --expected=/tmp/hiphot-hubspot-import-result.json \
  --report=/tmp/hiphot-hubspot-post-import-verification.json \
  --report-md=/tmp/hiphot-hubspot-post-import-verification.md
```

1. CRM aantallen
   - totaal HipHot bedrijven
   - bedrijven met marketing toegestaan
   - bedrijven met Factor 30
   - bedrijven met Factor 50
   - bedrijven met HubSpot company-ID
   - contactpersonen met HubSpot contact-ID

2. Steekproef in CRM
   - 10 nieuwe bedrijven
   - 10 bijgewerkte bestaande bedrijven
   - 5 bedrijven met Factor 30
   - 5 bedrijven met Factor 50
   - 5 bedrijven met HubSpot deals/notities

3. Tenantveiligheid
   - controleer dat alle geïmporteerde records `tenant='hiphot'` hebben
   - controleer dat er geen records in tenant `48-7` zijn aangepast
   - controleer dat het post-import rapport geen HubSpot-markeringen buiten HipHot meldt

4. Rapportage
   - bewaar het JSON-rapport
   - bewaar het Markdown-rapport
   - bewaar het post-import verificatierapport
   - noteer importdatum, commit en bronbestanden

## Fase 5: HubSpot uitfaseren

HubSpot pas opzeggen nadat:

- exportbestanden veilig bewaard zijn
- importresultaat is goedgekeurd
- steekproeven in CRM kloppen
- marketingsegmenten op bedrijfsniveau kloppen
- niet-gekoppelde deals/notities zijn beoordeeld
- HubSpot nieuwsbrieffunctionaliteit niet meer nodig is of expliciet als latere Resend-fase gepland staat

## Openstaande punten

- Echte HubSpot-exportbestanden zijn nog nodig.
- Segmentnamen buiten Factor 30, Factor 50 en Algemene nieuwsbrief moeten met echte HubSpot-data worden bevestigd.
- Newsletter sending vanuit CRM met Resend is fase 2 en nog niet gebouwd.
