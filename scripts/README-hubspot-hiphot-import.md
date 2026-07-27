# HubSpot naar HipHot CRM import

Deze import is alleen bedoeld voor de HipHot tenant (`hiphot`). Het script heeft geen tenant-argument en kan daardoor niet per ongeluk naar `48-7` schrijven.

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

Als HubSpot lijstlidmaatschappen niet in de contact-export zitten, exporteer de relevante lijsten apart en voeg ze als kolommen toe aan het contactbestand voordat de import draait.

## Dry-run

```bash
node scripts/import-hubspot-hiphot.mjs \
  --companies=/pad/naar/hubspot-companies.xlsx \
  --contacts=/pad/naar/hubspot-contacts.xlsx \
  --report=/tmp/hiphot-hubspot-import-report.json
```

Dit schrijft niets naar CRM. Controleer daarna:

- aantal nieuwe bedrijven
- aantal bestaande bedrijven dat bijgewerkt wordt
- aantal contactpersonen
- aantal bedrijven met marketing toegestaan
- Factor 30 en Factor 50 aantallen
- waarschuwingen over onbekende marketingstatussen of niet-herkende segmenten

## Live import

Alleen uitvoeren na controle van de dry-run:

```bash
node scripts/import-hubspot-hiphot.mjs \
  --companies=/pad/naar/hubspot-companies.xlsx \
  --contacts=/pad/naar/hubspot-contacts.xlsx \
  --report=/tmp/hiphot-hubspot-import-report.json \
  --commit
```

Standaard vult de import bestaande CRM-velden alleen aan als ze leeg zijn. Marketingvelden, HubSpot ID's en importmetadata worden wel bijgewerkt. Gebruik `--overwrite` alleen als HubSpot bewust leidend moet zijn voor bestaande CRM-velden.

## Wat wordt waar opgeslagen?

- Bedrijven worden CRM-leads met `tenant='hiphot'`.
- Marketingtoestemming, segmenten en tags worden op bedrijfsniveau opgeslagen op de lead.
- Contactpersonen blijven contactpersonen onder het bedrijf.
- HubSpot contact-ID's worden alleen gebruikt voor dedupe/audit, niet voor marketing op contactniveau.
- De ruwe geïmporteerde HubSpot-rijen worden als activiteit-metadata bewaard, zodat exportdata later terug te vinden is.
