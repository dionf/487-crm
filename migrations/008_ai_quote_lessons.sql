-- AI offerte-advies: geleerde lessen + flags
CREATE TABLE IF NOT EXISTS ai_quote_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant TEXT NOT NULL,
  lesson TEXT NOT NULL,
  context_tags TEXT[] NOT NULL DEFAULT '{}',
  priority INTEGER DEFAULT 5,
  is_active BOOLEAN DEFAULT true,
  flag_count INTEGER DEFAULT 0,
  source_quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  source_submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
  initial_quote JSONB,
  final_quote JSONB,
  chat_log JSONB,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  promoted_to_base BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_ai_lessons_tenant_active ON ai_quote_lessons(tenant, is_active);
CREATE INDEX IF NOT EXISTS idx_ai_lessons_tags ON ai_quote_lessons USING GIN (context_tags);
CREATE INDEX IF NOT EXISTS idx_ai_lessons_priority ON ai_quote_lessons(priority DESC);

-- Flags per user per lesson (max 1 per user)
CREATE TABLE IF NOT EXISTS ai_quote_lesson_flags (
  lesson_id UUID REFERENCES ai_quote_lessons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (lesson_id, user_id)
);
