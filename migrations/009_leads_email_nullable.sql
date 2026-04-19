-- Cold-call leads (import uit lijsten zoals Zonvenant Partners) hebben niet altijd
-- een e-mailadres. De legacy NOT NULL constraint op leads.email blokkeerde de import.
-- E-mail blijft verplicht op UI-niveau (LeadForm) en server-side (POST /api/leads) —
-- alleen bulk-import en chatbot/IMAP-paden kunnen 'm nu leeg laten.

ALTER TABLE leads ALTER COLUMN email DROP NOT NULL;
