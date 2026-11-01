# Plan: campagne-overzicht los van "Nieuwe campagne"

Status: **plan, nog niet gebouwd**. Wacht op akkoord van Dion.
Mockup: [`docs/mockup-nieuwsbrief-campagne-overzicht.html`](mockup-nieuwsbrief-campagne-overzicht.html) (open hem in de browser).

## 1. Hoe het nu zit

| Onderdeel | Bestand | Wat er staat |
|---|---|---|
| Pagina Nieuwsbrieven | `app/admin/nieuwsbrieven/page.jsx` (1636 regels) | Tabs Campagnes, Resend, Segmenten en Nog geen nieuwsbrief. In de tab Campagnes staat bovenaan het formulier "Nieuwe campagne" of "Campagne bewerken" (beide modi), daaronder de tabel "Campagnes" met het veld "Testmail naar", en daaronder een paneel met de gekozen campagne en de ontvangers. |
| Campagnepagina | `app/admin/nieuwsbrieven/[id]/page.jsx` | Alleen voor `mode = personalized` (een standaardcampagne geeft een foutmelding). Bovenaan `CampaignSettings`, daaronder `PersonalizedCampaignPanel` met de stappen 1. Inhoud, 2. Personalisatie, 3. Voorbeeld en verzenden, en 4. Social posts (PR #45). |
| Gepersonaliseerde flow | `components/newsletter/*` | `PersonalizedContentEditor` (items plus artikeltekst, PR #44), `PersonalizationReview`, `PersonalizedPreview` (testmail en verzenden), `SocialPosts`, `SampleCompanies`, `CampaignSettings`. |
| API | `app/api/newsletter/campaigns/route.js` (GET lijst, POST nieuw), `[id]/route.js` (GET, PATCH, DELETE), `[id]/test`, `[id]/send`, `[id]/recipients` | GET geeft alle campagnes van de tenant terug, nieuwste eerst, zonder filter. POST eist voor `broadcast` een naam, onderwerp en HTML, en voor `personalized` alleen een naam en onderwerp. |
| Menu | `components/Navbar.jsx:208` | `/admin/nieuwsbrieven` |

**Statussen** (`newsletter_campaigns.status`, CHECK in migratie 016): `draft`, `tested`, `approved`, `syncing`, `scheduled`, `sent`, `failed`, `batch_waiting` en `paused`. De labels en kleuren staan nu dubbel en verschillen per pagina: `syncing` heet "Synchroniseren" op de overzichtspagina en "Bezig met verzenden" op de campagnepagina. Bewerken mag bij `draft`, `tested` en `failed`. Het veld `sent_at` bestaat al.

**Wat er rommelig aan is.** Het grote formulier staat altijd bovenaan. Bewerken van een standaardcampagne gebeurt in datzelfde formulier, bovenaan de lijst. Testmail kan op drie plekken: in de tabelkop, per rij en in het paneel van de gekozen campagne. Concepten en verzonden campagnes staan door elkaar.

## 2. Schermen en routes

Er zijn drie schermen. De tabs Resend, Segmenten en Nog geen nieuwsbrief blijven zoals ze zijn.

### A. Overzicht: `/admin/nieuwsbrieven` (standaardweergave van de tab Campagnes)

- Kop met de titel "Nieuwsbrieven" en rechts de primaire knop **+ Nieuwe campagne**, die naar scherm B gaat.
- **Statusfilter** met chips en aantallen: `Alle · Concept · Ingepland · Bezig met verzenden · Verzonden`. Het filter staat in de URL (`?status=concept`), zodat "Terug" vanaf een campagne op hetzelfde filter uitkomt.
- **Bij "Alle"** ziet Dion twee blokken: eerst "Lopend en concept" (concept, ingepland en bezig), daarna "Verzonden". Zo staan concepten nooit tussen oude verzendingen.
- Een zoekveld op naam of onderwerp (alleen in de browser; de lijst is klein).
- **Tabel** met de kolommen Campagne (naam, onderwerp en een badge "Gepersonaliseerd"), Doelgroep (doelgroepen plus "niet mailen"), Status (badge, met daaronder de batchvoortgang of de pauzereden) en Datum. De datum hangt af van de status: aangemaakt bij een concept, gepland op bij ingepland, en verzonden op (`sent_at`) met het aantal ontvangers bij verzonden.
- **Acties per rij**: een klik op de rij of op de knop **Openen** gaat naar scherm C. Het menu ⋯ bevat Ontvangers bekijken (opent een zijpaneel), Verwijderen (alleen bij een concept) en, als optie voor later, Dupliceren.
- **Geen** testmail, verzenden of bewerken meer in het overzicht. Dat gebeurt allemaal op de campagnepagina.
- Een lege staat per filter, bijvoorbeeld "Nog geen concepten" met de knop Nieuwe campagne.

### B. Nieuwe campagne: `/admin/nieuwsbrieven/nieuw`

Een eigen route, zodat het formulier niet meer altijd in beeld staat. Er zijn twee stappen op één pagina.

1. **Soort kiezen** met twee grote kaarten: *Standaard (eigen HTML)* en *Gepersonaliseerd per bedrijf*, elk met een regel uitleg.
2. **Basisgegevens**: interne naam, onderwerp, previewtekst, doelgroepen ("Mailen naar") en uitsluitingen ("Niet mailen naar").
   - Bij *Gepersonaliseerd* komen daar de opzet, de kop, het kopbeeld en de inleiding bij (dezelfde velden als nu). Met **Concept aanmaken** ga je naar `/admin/nieuwsbrieven/[id]`, waar je verder werkt aan de items, de personalisatie, het voorbeeld en de social posts. Zo werkt het nu ook al.
   - Bij *Standaard* komen de HTML-editor met preview, de verzenddatum en de automatische batches erbij. Met **Concept aanmaken** ga je naar `/admin/nieuwsbrieven/[id]`.
- Met **Annuleren** ga je terug naar het overzicht.

### C. Campagnepagina: `/admin/nieuwsbrieven/[id]` (nu voor beide soorten)

- Een vaste kop met "← Alle nieuwsbrieven" (terug naar het overzicht met het filter), de naam, de statusbadge, het soort en het onderwerp.
- **Een actiebalk** op één plek, voor beide soorten: het veld *Testmail naar* plus **Testmail**, **Ontvangers** en de verzendknop (Verzenden, Plannen of Start batches, met dezelfde regels als nu: eerst een testmail, en na een wijziging opnieuw testen).
- **Gepersonaliseerd**: verder hetzelfde als nu (`CampaignSettings` en `PersonalizedCampaignPanel`). De testmail en het verzenden blijven daarnaast in stap 3, omdat ze daar bij het voorbeeld per bedrijf horen. De actiebalk toont alleen de status en een knop "Naar verzenden" die stap 3 opent, zodat er geen tweede verzendknop ontstaat.
- **Standaard**: een nieuw component `BroadcastCampaignEditor`, gemaakt uit het huidige formulier in `page.jsx`. Het bevat de velden, de verzendtijd, de batches, de uitsluitingen en de HTML met preview, plus Opslaan.
- **Verzonden of bezig**: alles is alleen-lezen. Je ziet het aantal ontvangers, `sent_at`, de batchvoortgang en health, en de ontvangerslijst. Bewerken is niet mogelijk; dat is nu ook al zo.

### Het pad door de schermen

```
Overzicht ──[+ Nieuwe campagne]──▶ /nieuw ──[Concept aanmaken]──▶ /[id]
   ▲  │                                                            │
   │  └──[klik op rij / Openen]─────────────────────────────────────▶ │
   └──────────────────────[← Alle nieuwsbrieven (?status=…)]────────┘
```

## 3. Statussen en filter

Een nieuw bestand `lib/newsletter-status.js` (zonder serverimports, dus bruikbaar in de browser) wordt de enige bron voor labels, kleuren, groepen en regels. `page.jsx`, `[id]/page.jsx` en `PersonalizedCampaignPanel` gebruiken het straks allemaal.

| Filtergroep | DB-statussen | Badge |
|---|---|---|
| Concept | `draft`, `tested`, `approved`, `failed` | Concept (grijs), Getest (blauw), Mislukt (rood) |
| Ingepland | `scheduled` | Gepland (oranje), met de datum |
| Bezig met verzenden | `syncing`, `batch_waiting`, `paused` | Bezig / Batch wacht (oranje), Gepauzeerd (rood, met reden) |
| Verzonden | `sent` | Verzonden (groen), met de datum en het aantal ontvangers |

- `failed` valt onder Concept, omdat je de campagne dan weer kunt bewerken en opnieuw kunt testen. De rode badge laat zien dat er iets mis is gegaan.
- `paused` valt onder Bezig, want de batchverzending loopt nog en wacht op een actie.
- Het filter werkt in de browser op de lijst die er al is (GET `/api/newsletter/campaigns`). Een API-parameter is pas nodig als de lijst groot wordt.
- Binnen een groep staat de nieuwste bovenaan. Bij Ingepland staat de eerstvolgende bovenaan.

## 4. Testmail en acties: waar komt wat

| Actie | Nu | Straks |
|---|---|---|
| Nieuwe campagne | Altijd zichtbaar formulier | Knop in het overzicht, die naar `/nieuw` gaat |
| Bewerken van een standaardcampagne | Formulier bovenaan de lijst | `/[id]` |
| Openen van een gepersonaliseerde campagne | Knop "Openen" | Klik op de rij of op "Openen", naar `/[id]` |
| Testmail | Tabelkop, rij en paneel | Alleen op `/[id]` (actiebalk; bij een gepersonaliseerde campagne in stap 3) |
| Verzenden, plannen of batches | Rij | Alleen op `/[id]`, in de actiebalk |
| Ontvangers bekijken | Rij, met een paneel onder de tabel | ⋯ in het overzicht (zijpaneel) en de knop op `/[id]` |
| Verwijderen | Rij | ⋯ in het overzicht (alleen bij een concept) en op `/[id]` |

## 5. Bestanden die veranderen

- `lib/newsletter-status.js`: **nieuw**, met de labels, de kleuren, `STATUS_GROUPS`, `canMutateCampaign`, `canSendCampaign` en de helpers voor de verzendlabels.
- `components/newsletter/CampaignList.jsx`: **nieuw**, met de filterchips, de groepen en de tabel.
- `components/newsletter/RecipientsDrawer.jsx`: **nieuw**, het ontvangerspaneel uit `page.jsx`.
- `components/newsletter/AudienceFields.jsx`: **nieuw**, met de doelgroepen, de uitsluitingen en de segmentlogica (`segmentCanExclude` en dergelijke) uit `page.jsx`. Het wordt gebruikt in `/nieuw` en in de standaardeditor.
- `components/newsletter/BroadcastCampaignEditor.jsx`: **nieuw**, met het formulier voor een standaardcampagne (bewerken), de verzendtijd en de batches.
- `components/newsletter/CampaignActionBar.jsx`: **nieuw**, met de testmail, de ontvangers en de verzendknop.
- `app/admin/nieuwsbrieven/nieuw/page.jsx`: **nieuw**, met de stap Soort en daarna Basisgegevens.
- `app/admin/nieuwsbrieven/page.jsx`: **veel kleiner**. Het formulier en de testmail gaan eruit; de tabs en het `CampaignList` blijven. Resend en Segmenten blijven ongewijzigd.
- `app/admin/nieuwsbrieven/[id]/page.jsx`: laadt beide soorten, toont de actiebalk en kiest de editor op basis van `mode`.
- `components/newsletter/PersonalizedCampaignPanel.jsx`: alleen `EDITABLE_STATUSES` uit de gedeelde lib halen.
- Geen API-wijzigingen nodig. Het enige punt om over na te denken: `/nieuw` voor een standaardcampagne vraagt de HTML meteen, omdat POST die verplicht stelt. Dat laten we zo, om de API niet aan te raken.

## 6. Migraties

**Geen.** Alle statussen en `sent_at` bestaan al, en het filter werkt in de browser.

## 7. Risico's

- **Gedrag van standaardcampagnes verschuift.** De regels voor testen, opnieuw testen, plannen en batches (`formNeedsRetest`, `canSaveAndPlanFromForm`, `hasExpiredSchedule`) gaan mee naar een ander component. Een fout daarin kan betekenen dat er verstuurd wordt zonder geldige test. Daarom verplaatsen we ze ongewijzigd naar `lib/newsletter-status.js` of de editor, en testen we ze per pad met een testsegment. Er wordt niets echt verzonden.
- **Twee testmail- of verzendknoppen bij een gepersonaliseerde campagne.** Opgelost door de actiebalk daar naar stap 3 te laten verwijzen.
- **Gewenning.** Wie gewend is aan het formulier bovenaan, zoekt even. De knop "Nieuwe campagne" staat prominent rechtsboven.
- **Werk dat parallel loopt aan de nieuwsbrief** (PR's #38 tot en met #45 in één week). Kleine PR's beperken de kans op mergeconflicten in `page.jsx`.
- **Tenantverschil.** HipHot gebruikt vooral standaardcampagnes met batches. Dat pad moet op de `hiphot`-tenant net zo goed werken als nu.
- **De weekstart van maandag.** Niets hiervan is nodig om de voorbeelden te versturen; die lopen via de bestaande campagnepagina. Bouwen kan dus na maandag, zonder risico voor de voorbeelden.

## 8. Volgorde in kleine PR's

Elke PR krijgt vooraf een `code-review`, wordt lokaal getest op beide tenants en gaat alleen met akkoord van Dion naar main.

1. **PR 1: gedeelde status-lib en het overzicht.** `lib/newsletter-status.js` en `CampaignList` met de filterchips, de groepen, de datumkolom en `?status=` in de URL. Het formulier blijft er in deze PR nog boven staan, achter een uitgeklapte knop "Nieuwe campagne" (een tussenstap die al minder rommelig is). Dit levert het meeste op voor het minste risico.
2. **PR 2: `/nieuw` als eigen route.** Het aanmaakformulier verhuist naar de nieuwe route en wordt `AudienceFields`. In het overzicht staat alleen nog de knop.
3. **PR 3: de campagnepagina voor standaardcampagnes.** `BroadcastCampaignEditor` en `CampaignActionBar` op `/[id]`. Bewerken, testmail en verzenden gaan weg uit het overzicht. Ontvangers komen in het zijpaneel.
4. **PR 4: afronding.** Alleen-lezenweergave voor verzonden campagnes met de statistieken, lege staten, (optioneel) Dupliceren, en de oude code opruimen uit `page.jsx`.

## 9. Open vragen voor Dion

1. Moet het overzicht standaard op **Alle** openen (met de twee blokken), of meteen op **Concept**?
2. Wil je **Dupliceren** erbij ("Nieuwsbrief december" maken op basis van november)? Voor een gepersonaliseerde campagne betekent dat de items kopiëren. Dat is een aparte, iets grotere PR.
3. Mag de standaardmodus later een concept **zonder HTML** toestaan? Dat vraagt een kleine API-wijziging, waarna `/nieuw` voor beide soorten even kort wordt.
