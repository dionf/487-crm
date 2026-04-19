-- Stap 1: repareer eerder (handmatig) geïmporteerde kinderopvang-leads
-- die industry/category="Kinderopvang" hebben gekregen ipv de dropdown-id "zorg".
-- Zet tegelijk source='zonvenant_partners' zodat ze consistent gelabeld zijn.

-- Eerst kijken WAT je gaat updaten (dry-run style):
SELECT id, company_name, industry, category, source
FROM leads
WHERE tenant = 'hiphot'
  AND (
    LOWER(COALESCE(industry, '')) LIKE '%kinderopvang%'
    OR LOWER(COALESCE(category, '')) LIKE '%kinderopvang%'
  );

-- Als de lijst klopt, run de update:
UPDATE leads
SET industry = 'zorg',
    category = NULL,
    source = COALESCE(NULLIF(source, ''), 'zonvenant_partners')
WHERE tenant = 'hiphot'
  AND (
    LOWER(COALESCE(industry, '')) LIKE '%kinderopvang%'
    OR LOWER(COALESCE(category, '')) LIKE '%kinderopvang%'
  );

-- Optioneel: als je alle leads die je al via Zonvenant hebt toegevoegd harder wilt labelen
-- (bv. als ze al 'zorg'/'kinderopvang' stonden maar geen source hadden), kun je ook:
-- UPDATE leads SET source = 'zonvenant_partners'
-- WHERE tenant = 'hiphot'
--   AND source IS NULL
--   AND industry = 'zorg'
--   AND created_at > '2026-04-01';   -- pas datum aan naar wanneer je begon te importeren
