-- Voeg 'geen_lead' status toe aan de CHECK constraint zodat contactformulier-vragen,
-- spam, sollicitaties etc. een eigen status krijgen ipv 'verloren' (geeft scheef beeld
-- in conversie-rapportage).

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;

ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (
  status IN (
    -- 48-7 pipeline
    'nieuw',
    'gekwalificeerd',
    'inventarisatie',
    'offerte_verstuurd',
    'onderhandeling',
    'gewonnen',
    'verloren',
    -- HipHot pipeline
    'prospect',
    'nieuwe_aanvraag',
    'terugbellen',
    'offerte_gestuurd',
    'reminder_gestuurd',
    'offerte_in_de_wacht',
    'in_overweging',
    'offerte_gewonnen',
    'offerte_verloren',
    -- Tenant-agnostisch
    'geen_lead'
  )
);
