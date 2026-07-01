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

-- USAGE EVENTS (raw event log — one row per API request, append-only)
CREATE TABLE IF NOT EXISTS usage_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID REFERENCES orgs(id) ON DELETE CASCADE,
  api_key_id  UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  endpoint    TEXT NOT NULL,
  method      VARCHAR(10) NOT NULL,
  status_code INTEGER,               -- NULL for allowed (controller sets real code); 429 for throttled
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Nearly every query filters by org + time range
CREATE INDEX IF NOT EXISTS idx_usage_events_org_time
  ON usage_events(org_id, created_at DESC);

-- USAGE SUMMARIES (hourly rollups — what billing reads, not raw events)
CREATE TABLE IF NOT EXISTS usage_summaries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID REFERENCES orgs(id) ON DELETE CASCADE,
  period_start   TIMESTAMPTZ NOT NULL,   -- truncated to hour e.g. 2025-01-15 14:00:00+00
  period_end     TIMESTAMPTZ NOT NULL,   -- period_start + 1 hour
  request_count  INTEGER NOT NULL DEFAULT 0,
  throttle_count INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(org_id, period_start)   -- required for upsert idempotency in aggregation job
);

CREATE INDEX IF NOT EXISTS idx_usage_summaries_org_period
  ON usage_summaries(org_id, period_start DESC);

-- BILLING: New columns on orgs
-- stripe_customer_id: created on first checkout, used as fallback org lookup in webhooks
-- stripe_subscription_id: updated by checkout.session.completed, cleared on subscription.deleted
-- payment_status: 'active' | 'past_due' | 'canceled' — separate from plan_tier
--   (org can be on pro but past_due: they haven't paid yet but still in grace period)
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS payment_status         TEXT NOT NULL DEFAULT 'active';

-- BILLING EVENTS (immutable audit log — never delete rows from this table)
-- stripe_event_id UNIQUE is the most critical constraint in this phase:
-- Stripe delivers webhooks at-least-once. The second delivery of the same event
-- hits a unique violation (23505), which we catch and silently ignore.
-- Without this, double-processing a payment is a real bug class.
CREATE TABLE IF NOT EXISTS billing_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID REFERENCES orgs(id) ON DELETE CASCADE,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  processed_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_org
  ON billing_events(org_id, processed_at DESC);
