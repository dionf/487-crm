-- 037: trajecten (opportunities).
--
-- Eén bedrijf (lead) kan meerdere trajecten hebben, elk met een eigen
-- pipelinestatus, waarde en offertes. Het dashboard en de kanban tellen
-- trajecten. leads.status / estimated_value / won_at blijven bestaan als
-- spiegel van het "huidige traject" (oudste open traject, anders het laatst
-- bijgewerkte), zodat bestaande schrijvers (inbox-intake,
-- formulieren, HipHot-belflow, MCP) blijven werken:
--   * wijzigt een traject  → de lead volgt;
--   * wijzigt leads.status (of waarde) direct → het huidige traject volgt;
--   * nieuwe lead → automatisch een eerste traject.
-- De vlag crm.opp_sync voorkomt dat de twee richtingen elkaar terugschrijven.

CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant TEXT NOT NULL,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  service_type TEXT,
  estimated_value NUMERIC,
  won_at TIMESTAMPTZ,
  lost_at TIMESTAMPTZ,
  win_reason TEXT,
  lost_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_tenant_status ON opportunities (tenant, status);
CREATE INDEX IF NOT EXISTS idx_opportunities_lead ON opportunities (lead_id);

-- Alleen de service role (API, server) leest en schrijft trajecten.
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_opportunity ON quotes (opportunity_id);

-- ---------------------------------------------------------------------------
-- Hulpfuncties

CREATE OR REPLACE FUNCTION opportunity_is_closed(p_status TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status IN ('gewonnen', 'offerte_gewonnen', 'verloren', 'offerte_verloren', 'geen_lead');
$$;

CREATE OR REPLACE FUNCTION opportunity_default_name(p_service_type TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_service_type
    WHEN 'discovery' THEN 'Discovery / Intake'
    WHEN 'cowork_setup' THEN 'Cowork Setup'
    WHEN 'training' THEN 'Training / Workshop'
    WHEN 'maatwerk' THEN 'Maatwerk Project'
    WHEN 'support_contract' THEN 'Support Contract'
    WHEN 'partner' THEN 'Partner Deal'
    ELSE 'Eerste traject'
  END;
$$;

CREATE OR REPLACE FUNCTION current_opportunity_id(p_lead_id UUID)
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM opportunities
   WHERE lead_id = p_lead_id
   ORDER BY opportunity_is_closed(status),
            -- open: het oudste traject blijft leidend, zodat een nieuw (vroeg)
            -- traject de status van een lopend traject niet overneemt;
            -- alles gesloten: het laatst bijgewerkte.
            CASE WHEN opportunity_is_closed(status) THEN updated_at END DESC NULLS LAST,
            created_at ASC
   LIMIT 1;
$$;

-- Zet de spiegelvelden op de lead naar het huidige traject.
CREATE OR REPLACE FUNCTION sync_lead_from_opportunities(p_lead_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  o opportunities%ROWTYPE;
BEGIN
  SELECT * INTO o FROM opportunities WHERE id = current_opportunity_id(p_lead_id);
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM set_config('crm.opp_sync', 'on', true);
  UPDATE leads
     SET status = o.status,
         estimated_value = o.estimated_value,
         won_at = o.won_at,
         win_reason = o.win_reason,
         lost_reason = o.lost_reason
   WHERE id = p_lead_id
     AND (status IS DISTINCT FROM o.status
       OR estimated_value IS DISTINCT FROM o.estimated_value
       OR won_at IS DISTINCT FROM o.won_at
       OR win_reason IS DISTINCT FROM o.win_reason
       OR lost_reason IS DISTINCT FROM o.lost_reason);
  PERFORM set_config('crm.opp_sync', 'off', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Triggers op opportunities

CREATE OR REPLACE FUNCTION opportunities_before_write()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  IF NEW.status IN ('gewonnen', 'offerte_gewonnen') AND NEW.won_at IS NULL THEN
    NEW.won_at := now();
  END IF;
  IF NEW.status IN ('verloren', 'offerte_verloren') AND NEW.lost_at IS NULL THEN
    NEW.lost_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunities_before_write_trigger ON opportunities;
CREATE TRIGGER opportunities_before_write_trigger
  BEFORE INSERT OR UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION opportunities_before_write();

CREATE OR REPLACE FUNCTION opportunities_after_write()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  from_lead BOOLEAN := coalesce(current_setting('crm.opp_sync', true), 'off') = 'on';
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NOT from_lead THEN
    INSERT INTO activities (lead_id, activity_type, description, metadata, tenant)
    VALUES (
      NEW.lead_id,
      'status_change',
      'Traject "' || NEW.name || '": ' || OLD.status || ' → ' || NEW.status,
      jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status, 'opportunity_id', NEW.id),
      NEW.tenant
    );
  END IF;

  IF from_lead THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM sync_lead_from_opportunities(OLD.lead_id);
  ELSE
    PERFORM sync_lead_from_opportunities(NEW.lead_id);
    IF TG_OP = 'UPDATE' AND OLD.lead_id IS DISTINCT FROM NEW.lead_id THEN
      PERFORM sync_lead_from_opportunities(OLD.lead_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS opportunities_after_write_trigger ON opportunities;
CREATE TRIGGER opportunities_after_write_trigger
  AFTER INSERT OR UPDATE OR DELETE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION opportunities_after_write();

-- ---------------------------------------------------------------------------
-- Triggers op leads

-- Nieuwe lead → eerste traject.
CREATE OR REPLACE FUNCTION leads_create_first_opportunity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('crm.opp_sync', 'on', true);
  INSERT INTO opportunities (tenant, lead_id, name, status, service_type, estimated_value, won_at, win_reason, lost_reason)
  VALUES (
    NEW.tenant, NEW.id, opportunity_default_name(NEW.service_type),
    coalesce(NEW.status, CASE WHEN NEW.tenant = 'hiphot' THEN 'nieuwe_aanvraag' ELSE 'nieuw' END),
    NEW.service_type, NEW.estimated_value, NEW.won_at, NEW.win_reason, NEW.lost_reason
  );
  PERFORM set_config('crm.opp_sync', 'off', true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS leads_create_first_opportunity_trigger ON leads;
CREATE TRIGGER leads_create_first_opportunity_trigger
  AFTER INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_create_first_opportunity();

-- Directe wijziging van status/waarde op de lead → huidige traject volgt.
CREATE OR REPLACE FUNCTION leads_push_to_current_opportunity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  opp_id UUID;
BEGIN
  IF coalesce(current_setting('crm.opp_sync', true), 'off') = 'on' THEN
    RETURN NULL;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.estimated_value IS NOT DISTINCT FROM NEW.estimated_value
     AND OLD.service_type IS NOT DISTINCT FROM NEW.service_type
     AND OLD.won_at IS NOT DISTINCT FROM NEW.won_at
     AND OLD.win_reason IS NOT DISTINCT FROM NEW.win_reason
     AND OLD.lost_reason IS NOT DISTINCT FROM NEW.lost_reason THEN
    RETURN NULL;
  END IF;

  opp_id := current_opportunity_id(NEW.id);
  IF opp_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Alleen velden die op de lead echt veranderden; service_type wordt niet
  -- gespiegeld en mag het traject niet overschrijven bij een statuswijziging.
  PERFORM set_config('crm.opp_sync', 'on', true);
  UPDATE opportunities o
     SET status = CASE WHEN OLD.status IS DISTINCT FROM NEW.status THEN NEW.status ELSE o.status END,
         estimated_value = CASE WHEN OLD.estimated_value IS DISTINCT FROM NEW.estimated_value THEN NEW.estimated_value ELSE o.estimated_value END,
         service_type = CASE WHEN OLD.service_type IS DISTINCT FROM NEW.service_type THEN NEW.service_type ELSE o.service_type END,
         won_at = CASE WHEN OLD.won_at IS DISTINCT FROM NEW.won_at THEN NEW.won_at ELSE o.won_at END,
         win_reason = CASE WHEN OLD.win_reason IS DISTINCT FROM NEW.win_reason THEN NEW.win_reason ELSE o.win_reason END,
         lost_reason = CASE WHEN OLD.lost_reason IS DISTINCT FROM NEW.lost_reason THEN NEW.lost_reason ELSE o.lost_reason END
   WHERE o.id = opp_id;
  PERFORM set_config('crm.opp_sync', 'off', true);

  -- Sloot dit het huidige traject af, dan is een ander traject nu het huidige:
  -- laat de lead dat traject spiegelen.
  PERFORM sync_lead_from_opportunities(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS leads_push_to_current_opportunity_trigger ON leads;
CREATE TRIGGER leads_push_to_current_opportunity_trigger
  AFTER UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_push_to_current_opportunity();

-- Statuslog op de lead alleen bij directe wijziging; een trajectwijziging
-- logt zelf (met trajectnaam).
CREATE OR REPLACE FUNCTION log_lead_status_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('crm.opp_sync', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO activities (lead_id, activity_type, description, metadata, tenant)
    VALUES (
      NEW.id,
      'status_change',
      'Status gewijzigd: ' || OLD.status || ' → ' || NEW.status,
      jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status),
      NEW.tenant
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: per bestaande lead één traject, offertes eraan gekoppeld.

SELECT set_config('crm.opp_sync', 'on', true);

INSERT INTO opportunities (
  tenant, lead_id, name, status, service_type, estimated_value,
  won_at, lost_at, win_reason, lost_reason, created_at, updated_at
)
SELECT
  l.tenant, l.id, opportunity_default_name(l.service_type), l.status, l.service_type, l.estimated_value,
  -- Zelfde terugval als het dashboard (won_at || updated_at), zodat de
  -- gemiddelde salescyclus niet verschuift.
  CASE WHEN l.status IN ('gewonnen', 'offerte_gewonnen') THEN coalesce(l.won_at, l.updated_at, l.created_at) ELSE l.won_at END,
  CASE WHEN l.status IN ('verloren', 'offerte_verloren') THEN coalesce(l.updated_at, l.created_at) END,
  l.win_reason, l.lost_reason,
  coalesce(l.created_at, now()), coalesce(l.updated_at, l.created_at, now())
FROM leads l
WHERE NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.lead_id = l.id);

-- Geen follow-up-taken laten ontstaan door deze koppel-update.
ALTER TABLE quotes DISABLE TRIGGER trigger_expired_quote;
ALTER TABLE quotes DISABLE TRIGGER trigger_quote_follow_up;

UPDATE quotes q
   SET opportunity_id = o.id
  FROM opportunities o
 WHERE o.lead_id = q.lead_id
   AND q.opportunity_id IS NULL;

ALTER TABLE quotes ENABLE TRIGGER trigger_expired_quote;
ALTER TABLE quotes ENABLE TRIGGER trigger_quote_follow_up;

SELECT set_config('crm.opp_sync', 'off', true);
