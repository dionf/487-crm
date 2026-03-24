# PRD: Multi-Tenant CRM — 48-7 + HipHot

**Status:** Draft v2
**Auteur:** Dion Fokkema
**Datum:** 2026-03-23
**Project:** 487CRM (Supabase + Vercel)

---

## Problem Statement

Het 48-7 CRM is gebouwd als single-tenant, single-user systeem. Dion runt naast 48-7 AI Professionals ook HipHot (B2B zonnebrand dispensers). Beide bedrijven hebben eigen medewerkers die onafhankelijk van elkaar in het CRM moeten werken. HipHot heeft specifiek een bellijst-workflow nodig waarbij agents leads bellen en uitkomsten registreren. Zonder multi-tenant + multi-user support moeten beide bedrijven in aparte tools werken, waardoor Dion als eigenaar van beide geen centraal overzicht heeft.

## Goals

1. **Organisatie-gescheiden toegang** — startscherm met organisatiekeuze + pincode, zodat users alleen hun eigen organisatie zien
2. **Multi-user per organisatie** — admin en agent rollen, met users die per organisatie worden beheerd
3. **HipHot bellijst workflow** — 591 leads importeren, verdelen onder agents, bel-uitkomsten registreren
4. **Tenant-specifieke pipelines** — 48-7 houdt zijn huidige sales pipeline, HipHot krijgt een bel/offerte pipeline
5. **Data-isolatie** — HipHot users zien nooit 48-7 data en vice versa, behalve Dion die in beide organisaties admin is
6. **N-tenant architectuur** — het systeem moet van dag 1 onbeperkt tenants aankunnen, niet hardcoded op 2

## Non-Goals

1. **Geen granulaire permissies in v1** — admin vs. agent rollen bestaan, maar in v1 is het enige verschil dat agents geen users kunnen aanmaken. Verdere rol-differentiatie komt later.
2. **Geen externe integraties voor HipHot in v1** — Moneybird, WooCommerce, Bol.com koppelingen komen later.
3. **Geen custom velden in v1** — HipHot-specifieke velden (dispenser model, locatietype) worden later toegevoegd.
4. **Geen wachtwoord-authenticatie** — we gebruiken een simpele pincode per user, geen volledige auth flow met wachtwoorden/SSO.
5. **Geen apart Supabase project** — alles blijft in hetzelfde project (`olzyffwotjtyvupomoiz`).

---

## User Stories

### Dion (admin, beide organisaties)

- **Als** Dion **wil ik** op het startscherm kiezen tussen 48-7 en HipHot **zodat** ik in de juiste organisatie terechtkom
- **Als** Dion **wil ik** een pincode invoeren per organisatie **zodat** onbevoegden niet zomaar toegang hebben
- **Als** Dion **wil ik** users aanmaken (naam + email) en toewijzen aan een organisatie **zodat** mijn team kan werken in het CRM
- **Als** Dion **wil ik** een Excel met leads importeren in HipHot **zodat** de bellijst direct beschikbaar is
- **Als** Dion **wil ik** leads verdelen onder HipHot agents **zodat** iedereen weet wie ze moeten bellen

### HipHot Agent

- **Als** HipHot agent **wil ik** de bellijst zien en kunnen filteren op mijn naam **zodat** ik weet wie ik moet bellen
- **Als** HipHot agent **wil ik** na het bellen een uitkomst registreren **zodat** de status van elke lead bijgewerkt wordt
- **Als** HipHot agent **wil ik** zien welke leads ik vandaag moet terugbellen **zodat** ik geen follow-ups mis

### 48-7 User

- **Als** 48-7 user **wil ik** het bestaande CRM gebruiken zoals het nu werkt **zodat** er niets kapot gaat aan de huidige workflow

---

## Requirements

### P0 — Must Have

**R1: Organisaties & Pincode toegang**
- Startscherm toont organisatie-knoppen (48-7, HipHot)
- Na klik op organisatie: gebruiker kiest naam uit lijst van users van die organisatie
- Daarna pincode invoer (4-6 cijfers, **per user** — niet per organisatie)
- Sessie wordt opgeslagen (localStorage), geldig voor **24 uur** — daarna opnieuw inloggen
- Acceptatie: verkeerde pin = geen toegang; juiste pin = CRM opent voor die user + organisatie

**R2: Users & Rollen**
- `users` tabel: id, name, email, role (`admin` | `agent`), organization_id, pin_hash
- Admin kan users aanmaken, bewerken, verwijderen
- Elke user heeft een eigen pincode
- Alle users (admin + agent) zien de volledige pipeline en alle leads
- Leads zijn filterbaar op agent (assigned_to) — geen harde data-isolatie tussen agents
- Initiële users HipHot: Dion Fokkema (admin), Vincent Pieters (admin)
- Dion bestaat als admin in beide organisaties
- Acceptatie: admin ziet user management pagina; agent ziet die niet

**R3: Tenant kolom op alle bestaande tabellen**
- Voeg `tenant` kolom (`text`, NOT NULL, default `'48-7'`) toe aan: `leads`, `notes`, `quotes`, `activities`, `attachments`, `follow_up_tasks`, `lead_inbox_log`
- Backfill alle bestaande records met `'48-7'`
- Alle queries filteren automatisch op actieve tenant
- Acceptatie: `SELECT DISTINCT tenant FROM leads` retourneert correcte waarden

**R4: Lead Import via UI**
- Admin-only pagina met Excel upload (drag & drop of file picker)
- Na upload: preview van de data + kolomherkenning
- Automatische mapping van bekende kolomnamen naar lead velden:
  - `Nr` → volgnummer (referentie)
  - `Organisatie` → company_name
  - `Plaats` → city (nieuw veld)
  - `Hoofdcategorie` → category (nieuw veld)
  - `Branche` → industry (nieuw veld)
  - `Adres` → address (nieuw veld)
  - `Telefoonnummer` → phone
  - `Email` → email
  - `Website` → website_url
  - `Opmerkingen` → internal_notes (wordt NIET getoond aan agents)
- Admin kan mapping controleren/aanpassen voor import
- Alle geïmporteerde leads krijgen status `nieuwe_aanvraag` en de actieve tenant
- Duplicaat-detectie op basis van company_name + email (waarschuwen, niet blokkeren)
- Voortgangsindicator bij grote imports
- Acceptatie: admin kan via UI een Excel uploaden en leads worden correct geïmporteerd

**R5: Lead toewijzing aan Agents**
- Admin kan leads (bulk) toewijzen aan agents
- `assigned_to` kolom op leads tabel (FK naar users)
- Alle users zien alle leads, maar kunnen filteren op agent
- Verdeling kan handmatig of automatisch (gelijk verdelen)
- Acceptatie: filter op agent toont alleen leads van die agent; default toont alles

**R6: Bel-uitkomsten registreren**
- Na het bekijken/bellen van een lead kiest de agent een uitkomst:
  - `voorstel_mailen` — lead wil voorstel ontvangen (status voor filtering; admins maken voorstel handmatig buiten CRM)
  - `terugbellen_5_dagen` — over 5 dagen terugbellen (maakt automatisch follow-up taak)
  - `geen_gehoor_terugbellen` — geen gehoor, later terugbellen (maakt follow-up taak voor volgende dag)
  - `niet_geinteresseerd` — lead wordt gemarkeerd als verloren
  - `vraag_opvolgen_collega` — lead wordt vrijgegeven voor toewijzing aan andere agent
- Bij elke uitkomst wordt een notitie aangemaakt met timestamp en agent naam
- Agent kan optioneel een vrije notitie toevoegen
- Acceptatie: elke bel-uitkomst resulteert in juiste statuswijziging + follow-up taak waar van toepassing

**R7: HipHot Pipeline**
- Pipeline stappen: `nieuwe_aanvraag` → `offerte_gestuurd` → `reminder_gestuurd` → `offerte_in_de_wacht` → `in_overweging` → `offerte_gewonnen` → `offerte_verloren`
- Pipeline configuratie via `tenant_config` tabel (niet hardcoded)
- Acceptatie: HipHot toont eigen pipeline, 48-7 behoudt bestaande pipeline

**R8: Bellijst view voor Agents**
- Tabel/kaart view met toegewezen leads
- Getoonde velden: Nr, Organisatie, Plaats, Hoofdcategorie, Branche, Adres, Telefoonnummer, Email, Website
- **Opmerkingen veld wordt NIET getoond**
- Sorteer/filter op: status, categorie, branche, plaats
- Visuele indicator van bel-uitkomst (kleur/icoon per status)
- "Volgende bellen" knop om snel door de lijst te gaan
- Acceptatie: agent kan efficiënt door bellijst werken zonder opmerkingen te zien

### P1 — Nice to Have

**R9: Tenant-specifieke UI theming**
- 48-7: blauw/paars accent
- HipHot: oranje/geel accent (conform HipHot huisstijl)
- Logo per organisatie op startscherm en in header

**R10: Bel-statistieken dashboard**
- Per agent: aantal gebeld, uitkomsten verdeling, terugbel-queue
- Totaal: voortgang bellijst (% gebeld), conversie naar offerte
- Acceptatie: admin ziet dashboard met real-time stats

**R11: Cross-tenant overzicht voor Dion**
- Optioneel dashboard dat metrics van beide bedrijven toont
- Alleen zichtbaar voor users die in meerdere organisaties admin zijn

### P2 — Future Considerations

- **Granulaire permissies** — meer rollen, feature-level toegang per rol
- **Custom velden per tenant** — flexibele velden voor HipHot (dispenser model, seizoen, etc.)
- **HipHot integraties** — Moneybird, WooCommerce, Bol.com in CRM
- **Email templates** — standaard voorstel-mail vanuit CRM versturen
- **Wachtwoord/SSO authenticatie** — ter vervanging van pincode

---

## Success Metrics

| Metric | Target | Type |
|--------|--------|------|
| HipHot leads geïmporteerd | 591 leads uit Excel | Leading |
| Agents actief in bellijst | Alle HipHot agents gebruiken CRM dagelijks | Leading |
| Bel-uitkomst registratie | >95% van gesprekken heeft uitkomst | Leading |
| Data-isolatie | 0 cross-tenant data leaks | Lagging |
| Follow-up compliance | 100% terugbel-taken worden opgepakt | Lagging |
| 48-7 CRM ongewijzigd | 0 regressies in bestaande functionaliteit | Lagging |

---

## Technical Design (high-level)

### Nieuwe tabellen

```sql
-- Organisaties
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,        -- '48-7', 'hiphot'
  display_name text NOT NULL,       -- '48-7 AI Professionals', 'HipHot'
  pipeline_stages jsonb NOT NULL,   -- ["nieuwe_aanvraag", "offerte_gestuurd", ...]
  service_types jsonb,              -- ["dispensers", "onderdelen", ...]
  theme jsonb,                      -- {"accent": "#FF6B00", "logo_url": "..."}
  created_at timestamptz DEFAULT now()
);

-- Users per organisatie (pin per user)
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  email text NOT NULL,
  pin_hash text NOT NULL,           -- gehashte pincode per user
  role text NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, email)
);
```

### Wijzigingen bestaande tabellen

```sql
-- Tenant kolom op alle tabellen
ALTER TABLE leads ADD COLUMN tenant text NOT NULL DEFAULT '48-7';
ALTER TABLE leads ADD COLUMN assigned_to uuid REFERENCES users(id);
ALTER TABLE leads ADD COLUMN city text;
ALTER TABLE leads ADD COLUMN category text;
ALTER TABLE leads ADD COLUMN industry text;
ALTER TABLE leads ADD COLUMN address text;
ALTER TABLE leads ADD COLUMN call_outcome text CHECK (call_outcome IN (
  'voorstel_mailen', 'terugbellen_5_dagen', 'geen_gehoor_terugbellen',
  'niet_geinteresseerd', 'vraag_opvolgen_collega'
));
ALTER TABLE leads ADD COLUMN last_called_at timestamptz;
ALTER TABLE leads ADD COLUMN last_called_by uuid REFERENCES users(id);
ALTER TABLE leads ADD COLUMN internal_notes text; -- opmerkingen (niet zichtbaar voor agents)

-- Idem voor andere tabellen
ALTER TABLE notes ADD COLUMN tenant text NOT NULL DEFAULT '48-7';
ALTER TABLE notes ADD COLUMN user_id uuid REFERENCES users(id);
ALTER TABLE quotes ADD COLUMN tenant text NOT NULL DEFAULT '48-7';
ALTER TABLE activities ADD COLUMN tenant text NOT NULL DEFAULT '48-7';
ALTER TABLE attachments ADD COLUMN tenant text NOT NULL DEFAULT '48-7';
ALTER TABLE follow_up_tasks ADD COLUMN tenant text NOT NULL DEFAULT '48-7';
ALTER TABLE follow_up_tasks ADD COLUMN assigned_to uuid REFERENCES users(id);
ALTER TABLE lead_inbox_log ADD COLUMN tenant text NOT NULL DEFAULT '48-7';
```

### Frontend architectuur

```
/                          → Startscherm (kies organisatie)
/pin                       → Pincode invoer
/select-user               → Kies wie je bent
/dashboard                 → Hoofdscherm (tenant-specifiek)
/leads                     → Lead lijst / bellijst
/leads/:id                 → Lead detail + bel-uitkomst
/pipeline                  → Pipeline view
/admin/users               → User beheer (alleen admin)
/admin/import              → Lead import (alleen admin)
```

- `OrganizationContext` — actieve organisatie + user
- Alle queries filteren op `tenant` automatisch
- Agent view toont alleen `assigned_to = currentUser` leads
- Bellijst is primaire view voor HipHot agents

### MCP tools update

- Alle CRM tools krijgen optionele `tenant` parameter (default `48-7`)
- Nieuwe tool: `crm_import_leads` voor bulk import
- Nieuwe tool: `crm_assign_leads` voor lead verdeling

---

## Beslissingen (beantwoord)

- **Pincode:** per user (niet per organisatie)
- **Zichtbaarheid:** alle users zien alles, filteren op agent mogelijk
- **"Voorstel mailen":** is een status/filter — voorstellen worden handmatig buiten CRM gemaakt, later uitbreidbaar
- **Quote nummers:** tenant-specifiek (`487-2026-001` vs `HH-2026-001`)
- **Initiële HipHot admins:** Dion Fokkema + Vincent Pieters
- **Sessieduur:** 24 uur
- **"Volgende bellen" knop:** ja, zit in P0 (R8)
- **HipHot service types:** niet nodig in v1, `service_type` veld is optioneel per tenant
- **Architectuur:** n-tenant van dag 1, niet hardcoded op 2 organisaties

## Open Questions

Alle vragen zijn beantwoord. PRD is klaar voor implementatie.

---

## Timeline & Fasering

### Fase 1 — Database & Auth (dag 1-2)
- Organizations + Users tabellen aanmaken
- Tenant kolom op alle bestaande tabellen + backfill
- Pincode auth flow
- RLS policies updaten

### Fase 2 — Frontend Multi-tenant basis (dag 3-5)
- Startscherm + pin + user selectie
- OrganizationContext provider
- User management (admin)
- Bestaande views tenant-aware maken

### Fase 3 — HipHot Bellijst (dag 6-8)
- Lead import uit Excel
- 591 Zonvenant Partners leads importeren
- Bellijst view voor agents
- Bel-uitkomst registratie + follow-up taken
- Lead toewijzing aan agents

### Fase 4 — Polish & Test (dag 9-10)
- UI theming per tenant
- Bel-statistieken dashboard
- End-to-end test beide tenants
- Regressietest 48-7 functionaliteit
- Documentatie + CLAUDE.md updaten

---

*Dit document is een levend document en wordt bijgewerkt op basis van feedback.*
