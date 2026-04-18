-- Chatbot intake: sla herkomst, transcript en gestructureerde data op bij form_submissions
ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'form',
  ADD COLUMN IF NOT EXISTS conversation_transcript TEXT,
  ADD COLUMN IF NOT EXISTS conversation_data JSONB;

-- Backfill: bestaande rijen komen uit het contactformulier
UPDATE form_submissions SET source = 'form' WHERE source IS NULL;

-- Index voor filteren per herkomst (contactformulier vs chatbot)
CREATE INDEX IF NOT EXISTS idx_form_submissions_source ON form_submissions(source);
