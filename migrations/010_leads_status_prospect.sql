-- Update leads_status_check constraint zodat 'prospect' (nieuwe HipHot status) is toegestaan.
-- Lijst bevat alle geldige statuses voor beide tenants.

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
    'offerte_verloren'
  )
);
