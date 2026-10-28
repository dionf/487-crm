-- 036: relaties buiten de salespipeline.
--
-- Een bedrijf blijft een lead met contacten, maar kan buiten de pipeline staan
-- (klant, partner, alleen nieuwsbrief). Zulke bedrijven tellen niet mee in het
-- dashboard, de kanban en de pipelinewaarde. relationship_type is het label op
-- de kaart; 'partner' komt erbij voor 48-7.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS in_pipeline BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_leads_tenant_in_pipeline
  ON leads (tenant, in_pipeline);

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_relationship_type_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_relationship_type_check
  CHECK (
    relationship_type IS NULL
    OR relationship_type IN (
      'customer',
      'partner',
      'mail_contact',
      'newsletter_contact',
      'website_activity',
      'hubspot_record'
    )
  );
