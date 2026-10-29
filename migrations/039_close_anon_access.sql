-- 039: de publieke anon key geeft geen toegang meer tot CRM-data.
--
-- Tot nu toe hadden de CRM-tabellen een RLS-policy "true" voor iedereen
-- (PUBLIC), waardoor de anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY) alle leads,
-- offertes, contacten en zelfs users.pin_hash van beide tenants kon lezen en
-- wijzigen. De webapp gebruikt uitsluitend supabaseAdmin (service role) en de
-- lokale 487crm-MCP draait voortaan met een eigen secret key; beide omzeilen
-- RLS, dus deze policies zijn niet meer nodig. Ook de policy uit 038 op
-- opportunities vervalt hiermee.
--
-- RLS blijft aan zonder policies: anon/authenticated zien niets. Daarnaast
-- worden de tabelrechten voor anon/authenticated ingetrokken als tweede slot.

-- Open policies weghalen
DROP POLICY IF EXISTS "Allow anon access" ON leads;
DROP POLICY IF EXISTS "Allow anon access" ON quotes;
DROP POLICY IF EXISTS "Allow anon access" ON notes;
DROP POLICY IF EXISTS "Allow anon access" ON activities;
DROP POLICY IF EXISTS "Allow anon access" ON opportunities;
DROP POLICY IF EXISTS "Allow anon access" ON attachments;
DROP POLICY IF EXISTS "Allow anon access" ON lead_inbox_log;
DROP POLICY IF EXISTS "Allow all operations on contacts" ON contacts;
DROP POLICY IF EXISTS "Allow all operations on follow_up_tasks" ON follow_up_tasks;
DROP POLICY IF EXISTS "All access quote_sections" ON quote_sections;
DROP POLICY IF EXISTS "All access quote_templates" ON quote_templates;
DROP POLICY IF EXISTS "Anyone can insert quote views" ON quote_views;
DROP POLICY IF EXISTS "Anyone can read quote views" ON quote_views;
DROP POLICY IF EXISTS "Allow all on users" ON users;

-- Tabelrechten voor anon/authenticated intrekken
REVOKE ALL ON
  leads, quotes, notes, activities, opportunities, attachments,
  lead_inbox_log, contacts, follow_up_tasks, quote_sections,
  quote_templates, quote_views, users
FROM anon, authenticated;

-- Storage: de bucket "attachments" is privé, maar iedereen mocht er lezen,
-- uploaden en verwijderen. De app en de MCP gebruiken de service role.
DROP POLICY IF EXISTS "Allow public read attachments" ON storage.objects;
DROP POLICY IF EXISTS "Allow public insert attachments" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete attachments" ON storage.objects;
