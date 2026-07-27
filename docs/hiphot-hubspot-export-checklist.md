# HipHot HubSpot export-checklist

Gebruik deze checklist om de HubSpot-bestanden klaar te zetten voor de CRM-migratie.

Doelmap:

```text
/tmp/hiphot-hubspot-export/
  hubspot-companies.xlsx
  hubspot-contacts.xlsx
  hubspot-deals.xlsx
  hubspot-notes.xlsx
  lijsten/
    Factor 30.csv
    Factor 50.csv
    Algemene nieuwsbrief.csv
```

## 1. Bedrijven exporteren

HubSpot object: Companies / Bedrijven.

Bestandsnaam:

```text
hubspot-companies.xlsx
```

Minimale kolommen:

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

Waarom nodig:

- Bedrijven worden CRM-leads in tenant `hiphot`.
- Company ID voorkomt dubbele bedrijven bij opnieuw importeren.
- Bedrijfsnaam, stad, domein en e-mail helpen bij matching met bestaande CRM-bedrijven.

## 2. Contactpersonen exporteren

HubSpot object: Contacts / Contactpersonen.

Bestandsnaam:

```text
hubspot-contacts.xlsx
```

Minimale kolommen:

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

Waarom nodig:

- Contacten worden onder het bedrijf opgeslagen.
- Marketingstatus wordt samengevat op bedrijfsniveau.
- Contact ID voorkomt dubbele contactpersonen bij opnieuw importeren.

## 3. Marketinglijsten exporteren

HubSpot lijsten of segmenten:

- Factor 30
- Factor 50
- Algemene nieuwsbrief / marketingmail

Map:

```text
lijsten/
```

Bestandsnamen:

```text
Factor 30.csv
Factor 50.csv
Algemene nieuwsbrief.csv
```

Minimale kolommen per lijst:

- Email, of
- Record ID / Contact ID, of
- Associated Company ID

Waarom nodig:

- Als lijstlidmaatschap niet volledig in `hubspot-contacts.xlsx` zit, gebruikt de importer deze losse lijsten.
- De bestandsnamen worden automatisch gekoppeld aan CRM-segmenten.
- Segmenten worden op bedrijfsniveau opgeslagen.

## 4. Deals exporteren

HubSpot object: Deals.

Bestandsnaam:

```text
hubspot-deals.xlsx
```

Minimale kolommen:

- Record ID / Deal ID
- Associated Company ID
- Company name
- Deal name
- Amount
- Deal stage
- Pipeline
- Close date
- Deal owner

Waarom nodig:

- Deals worden als interne CRM-notities onder het bedrijf bewaard.
- Ze worden niet omgezet naar offertes, zodat er geen valse offertehistorie ontstaat.

## 5. Notities exporteren

HubSpot object: Notes / Engagements.

Bestandsnaam:

```text
hubspot-notes.xlsx
```

Minimale kolommen:

- Record ID / Note ID
- Associated Company ID
- Company name
- Associated Contact Email
- Note body
- Create date / activity date
- Note owner / created by

Waarom nodig:

- Notities worden als interne CRM-notities onder het bedrijf bewaard.
- Note ID voorkomt dubbele historie-notities bij opnieuw importeren.

## 6. Eerste controle na export

Controleer voordat de audit draait:

- Bestanden openen zonder wachtwoord.
- Eerste rij bevat kolomnamen.
- Er is geen totaalregel of uitlegtekst boven de kolomnamen.
- E-mailadressen staan als tekst.
- Company ID en Contact ID zijn niet afgerond door spreadsheetsoftware.
- Lijstbestanden hebben herkenbare namen: `Factor 30`, `Factor 50`, `Algemene nieuwsbrief`.

## 7. Audit draaien

```bash
npm run import:hubspot:hiphot -- \
  --companies=/tmp/hiphot-hubspot-export/hubspot-companies.xlsx \
  --contacts=/tmp/hiphot-hubspot-export/hubspot-contacts.xlsx \
  --deals=/tmp/hiphot-hubspot-export/hubspot-deals.xlsx \
  --notes=/tmp/hiphot-hubspot-export/hubspot-notes.xlsx \
  --lists=/tmp/hiphot-hubspot-export/lijsten \
  --report=/tmp/hiphot-hubspot-export-audit.json \
  --report-md=/tmp/hiphot-hubspot-export-audit.md \
  --audit
```

Go/no-go:

- Factor 30 wordt herkend.
- Factor 50 wordt herkend.
- Algemene nieuwsbrief wordt herkend.
- Lijstbestanden zonder mapping zijn verklaard.
- Deal- en notitiekolommen worden gezien als die historie meegenomen moet worden.

## 8. Dry-run draaien

```bash
npm run import:hubspot:hiphot -- \
  --companies=/tmp/hiphot-hubspot-export/hubspot-companies.xlsx \
  --contacts=/tmp/hiphot-hubspot-export/hubspot-contacts.xlsx \
  --deals=/tmp/hiphot-hubspot-export/hubspot-deals.xlsx \
  --notes=/tmp/hiphot-hubspot-export/hubspot-notes.xlsx \
  --lists=/tmp/hiphot-hubspot-export/lijsten \
  --report=/tmp/hiphot-hubspot-import-dry-run.json \
  --report-md=/tmp/hiphot-hubspot-import-dry-run.md
```

De live import mag pas na akkoord op het Markdown dry-run rapport.
