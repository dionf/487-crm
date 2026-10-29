-- 040: OAuth 2.1 voor het remote MCP-endpoint (/api/mcp).
--
-- Collega's koppelen Claude als custom connector en loggen in met e-mail en
-- pincode. Elke koppeling (grant) hoort bij één gebruiker en dus bij één
-- tenant. Tokens staan alleen gehasht (sha256) in de database: wie deze tabel
-- leest, kan er niet mee inloggen.
--
-- Alleen de service role komt hier: RLS aan, geen policies.

CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

-- Een koppeling: wat de gebruiker op /mcp ziet en kan intrekken. expires_at is
-- de horizon van de refresh token; elke refresh schuift hem op.
CREATE TABLE IF NOT EXISTS oauth_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['crm'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_oauth_grants_user ON oauth_grants (user_id) WHERE revoked_at IS NULL;

-- Codes, access- en refresh tokens. code_challenge/redirect_uri alleen bij
-- kind = 'code'. used_at markeert een verbruikte code of geroteerde refresh
-- token: hergebruik daarvan trekt de hele koppeling in.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id UUID NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('code', 'access', 'refresh')),
  token_hash TEXT NOT NULL UNIQUE,
  code_challenge TEXT,
  redirect_uri TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_grant ON oauth_tokens (grant_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires ON oauth_tokens (expires_at);

ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON oauth_clients, oauth_grants, oauth_tokens FROM anon, authenticated;
