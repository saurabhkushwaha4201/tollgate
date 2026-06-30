-- USERS
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ORGS
CREATE TABLE IF NOT EXISTS orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  plan_tier VARCHAR(50) DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ORG MEMBERS (join table)
CREATE TABLE IF NOT EXISTS org_members (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, org_id)
);

-- REFRESH TOKENS
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- API KEYS
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID REFERENCES orgs(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  key_prefix   VARCHAR(16) NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

-- RATE LIMIT EVENTS
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID REFERENCES orgs(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  limited_at TIMESTAMPTZ DEFAULT NOW()
);

-- query pattern in Phase 4: "how many times was org X throttled this billing period?"
CREATE INDEX IF NOT EXISTS idx_rle_org_limited_at ON rate_limit_events(org_id, limited_at);