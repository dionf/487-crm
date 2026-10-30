-- 042: Eerste traject alleen voor bedrijven in de pipeline.
--
-- Een relatie buiten de pipeline (klant, partner, alleen nieuwsbrief,
-- voorbeeldbedrijf) kreeg via 037 toch een leeg "Eerste traject". Nu:
-- * bij aanmaken alleen een traject als in_pipeline niet false is;
-- * gaat een bedrijf later de pipeline in en heeft het nog geen traject,
--   dan wordt het eerste traject alsnog aangemaakt.

CREATE OR REPLACE FUNCTION leads_create_first_opportunity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.in_pipeline IS FALSE THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM opportunities WHERE lead_id = NEW.id) THEN
    RETURN NULL;
  END IF;
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

DROP TRIGGER IF EXISTS leads_first_opportunity_on_pipeline_trigger ON leads;
CREATE TRIGGER leads_first_opportunity_on_pipeline_trigger
  AFTER UPDATE OF in_pipeline ON leads
  FOR EACH ROW
  WHEN (OLD.in_pipeline IS FALSE AND NEW.in_pipeline IS NOT FALSE)
  EXECUTE FUNCTION leads_create_first_opportunity();
