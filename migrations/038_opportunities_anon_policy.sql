-- 038: opportunities volgt het RLS-patroon van leads/quotes.
--
-- De lokale 487crm-MCP (Claude-extensie) gebruikt de anon key. De triggers uit
-- 037 schrijven als de aanroepende rol, dus zonder deze policy faalde elke
-- anon-schrijfactie op leads (nieuw traject bij nieuwe lead, status naar het
-- huidige traject) en zag de MCP geen trajecten. leads staat al open voor anon,
-- dus dit voegt geen nieuwe blootstelling toe.

DROP POLICY IF EXISTS "Allow anon access" ON opportunities;
CREATE POLICY "Allow anon access" ON opportunities FOR ALL USING (true) WITH CHECK (true);
