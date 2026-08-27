# 🛣️ Tollgate

> **API infrastructure for multi-tenant SaaS — authentication, rate limiting, usage metering, and Stripe billing in one unified backend.**

[![CI](https://github.com/saurabhkushwaha4201/tollgate/actions/workflows/ci.yml/badge.svg)](https://github.com/saurabhkushwaha4201/tollgate/actions/workflows/ci.yml)

---

## 📖 What it is

Tollgate is a production-grade multi-tenant API backend covering the full lifecycle of a SaaS product — from org signup through API key issuance, rate limiting, usage metering, and Stripe billing. Built to demonstrate the engineering patterns that underpin real SaaS infrastructure, not a tutorial clone.

---

## ☁️ Live Deployment

| | |
|---|---|
| **Live Base URL** | `https://tollgate-api.onrender.com` |
| **Interactive Docs** | [https://tollgate-api.onrender.com/api-docs](https://tollgate-api.onrender.com/api-docs) |
| **Backend** | Render (Node.js / Express) |
| **Database** | Neon (Serverless PostgreSQL) |
| **Cache & Rate Limiting** | Upstash (Serverless Redis) |

---

## 📚 API Documentation (Swagger UI)

The API is fully documented with an interactive OpenAPI 3.0 spec. Every endpoint lists its request schema, all possible response shapes (including error bodies), auth requirements, RBAC role guards, and rate-limit headers.

### Live interactive docs

```
https://tollgate-api.onrender.com/api-docs
```

Open it in a browser → authenticate with the demo account below → use **Try it out** on any endpoint.

### Local docs (after running locally)

```
http://localhost:3000/api-docs
```

### Demo account (read-only sandbox)

| | |
|---|---|
| **Email** | `demo@tollgate.io` |
| **Password** | `Demo1234!` |

> **Note:** The demo account is sandboxed to read-only access — all GET endpoints are live, but mutating operations (creating API keys, inviting members, billing checkout) return `403 Forbidden`. This lets you explore every documented response shape without touching real data.

**Quick start — get a token from your terminal:**
```bash
curl -s -X POST https://tollgate-api.onrender.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@tollgate.io","password":"Demo1234!"}' | jq .accessToken
```

Then paste the token into the Swagger UI **Authorize** button (top right) and explore.

---

## 💻 Tech Stack

| Layer | Technology | Notes |
| :--- | :--- | :--- |
| **Runtime** | Node.js 20 + TypeScript | API server, background aggregation job, webhook handler |
| **Web Framework** | Express 5 | Routing and middleware chain |
| **Database** | PostgreSQL 16+ | Org/user/billing state, usage_events, usage_summaries |
| **Cache & State** | Redis 7 | Sliding-window rate limit buckets per org (sorted sets) |
| **Billing** | Stripe | Checkout sessions, subscription lifecycle, webhook events |
| **Validation** | Zod | Runtime schema validation with typed inference |
| **Logging** | Pino | Structured JSON logs with request IDs |
| **Infrastructure** | Render, Neon, Upstash, Docker | Cloud deployment & local container orchestration |

---

## ✨ Core Features

### 🔐 Auth & Access Control
- **Dual-token system:** Short-lived JWT access tokens (15 min) + SHA-256 hashed, database-backed refresh tokens (7 days) with rotation on every use.
- **Theft detection:** Reusing a rotated refresh token immediately revokes all sessions for that user.
- **RBAC:** Organization-scoped `member` / `admin` / `owner` role hierarchy enforced at the middleware layer.
- **Atomic onboarding:** User creation, org creation, and owner membership are a single database transaction — no partial state possible.
- **Timing-safe auth:** Dummy bcrypt compare on unknown emails prevents user enumeration via response timing.

### 🔑 API Key System
- **SHA-256 hashing:** Keys are hashed for fast per-request lookups without bcrypt overhead. The hash is the only thing stored.
- **Show-once pattern:** Full plaintext key returned once on creation and never again. The spec explicitly documents this.
- **Soft revocation:** `is_active = false` preserves historical usage records and audit trails.

### 🚦 Rate Limiting
- **Sliding window algorithm:** Redis sorted sets (`ZADD` / `ZCARD`) — no burst-traffic vulnerability of fixed-window counters.
- **Atomic Lua execution:** Core logic runs inside `EVALSHA` to eliminate TOCTOU race conditions.
- **Plan-aware quotas:** Limits derived from the org's Stripe billing tier at request time (Free: 60/min, Pro: 600/min).
- **Standard headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on every response.

### 📊 Usage Metering
- **Fire-and-forget logging:** Per-request `usage_events` inserts never block the response path.
- **Hourly rollup job:** Background cron aggregates raw events into `usage_summaries` via idempotent upserts — heavy analytics never hit the primary request path.
- **Billing-period alignment:** Usage queries anchor to each org's unique billing period start date, not a calendar month.

### 💳 Billing & Subscriptions (Stripe)
- **Hosted Checkout:** Stripe Checkout keeps the app out of PCI scope entirely.
- **Resilient webhooks:** HMAC-SHA256 signature verification + unique `stripe_event_id` constraint provides idempotency — Stripe's at-least-once delivery cannot cause double-processing.
- **Decoupled state sync:** Webhooks update `plan_tier` in the database; the rate limiter reads it on the next request. Zero direct coupling between billing and rate-limiting modules.
- **Triple metadata:** `org_id` stored on Stripe customer, session, and subscription so any webhook event type can be traced back to the org.

---

## 🏗️ Data Model

| Table | Purpose |
|---|---|
| `users` | Authentication identities |
| `orgs` | Tenant units — owns `plan_tier`, Stripe customer/subscription IDs |
| `org_members` | RBAC join table (user ↔ org ↔ role) |
| `refresh_tokens` | SHA-256 hashed refresh token store with expiry and revocation flag |
| `api_keys` | SHA-256 hashed API credentials per org |
| `usage_events` | Per-request raw event log (append-only) |
| `usage_summaries` | Hourly aggregated rollups for fast billing-period queries |
| `billing_events` | Idempotent Stripe webhook audit log (`stripe_event_id UNIQUE`) |

---

## 📡 API Reference

Full interactive documentation at [`/api-docs`](https://tollgate-api.onrender.com/api-docs). Quick reference:

### Auth

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/auth/register` | None | Creates user + org atomically |
| `POST` | `/auth/login` | None | Rate-limited. Returns JWT + refresh token |
| `POST` | `/auth/refresh` | `refreshToken` body | Token rotation — old token invalidated |
| `POST` | `/auth/logout` | `refreshToken` body | Deletes token from DB |
| `GET` | `/auth/me` | Bearer JWT | Returns user profile + all org memberships |

### Organizations & Members

| Method | Path | Auth | Min Role |
|---|---|---|---|
| `GET` | `/orgs/:orgId` | Bearer JWT | `member` |
| `GET` | `/orgs/:orgId/members` | Bearer JWT | `member` |
| `POST` | `/orgs/:orgId/members/invite` | Bearer JWT | `admin` |
| `PATCH` | `/orgs/:orgId/members/:uid` | Bearer JWT | `owner` |
| `DELETE` | `/orgs/:orgId/members/:uid` | Bearer JWT | `admin` |

### API Keys

| Method | Path | Auth | Min Role |
|---|---|---|---|
| `POST` | `/orgs/:orgId/api-keys` | Bearer JWT | `admin` |
| `GET` | `/orgs/:orgId/api-keys` | Bearer JWT | `member` |
| `DELETE` | `/orgs/:orgId/api-keys/:keyId` | Bearer JWT | `admin` |

### Rate Limiting & Usage

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/v1/ping` | `x-api-key` header | Rate limit test route |
| `GET` | `/orgs/:orgId/usage` | Bearer JWT | Current billing period |
| `GET` | `/orgs/:orgId/usage/history` | Bearer JWT | Paginated hourly history. Query params: `page` (default 1), `limit` (default 30, max 100) |

### Billing & Stripe

| Method | Path | Auth | Min Role |
|---|---|---|---|
| `POST` | `/orgs/:orgId/billing/checkout` | Bearer JWT | `owner` |
| `GET` | `/orgs/:orgId/billing/subscription` | Bearer JWT | `member` |
| `POST` | `/orgs/:orgId/billing/cancel` | Bearer JWT | `owner` |
| `POST` | `/billing/webhook` | Stripe signature | Internal — Stripe only |

---

## 🚀 Local Setup

### Prerequisites
- [Docker](https://www.docker.com/) & Docker Compose
- Node.js 20+
- [Stripe CLI](https://stripe.com/docs/stripe-cli) (for local webhook testing)

### Installation & Run

```bash
# 1. Clone the repository
git clone https://github.com/yourhandle/tollgate
cd tollgate

# 2. Configure environment
cp .env.example .env         # Fill in your secrets

# 3. Start local infrastructure (Postgres & Redis)
docker-compose up -d

# 4. Install dependencies and apply schema
npm install
npm run migrate

# 5. Start the development server
npm run dev

# 6. Open interactive docs
open http://localhost:3000/api-docs
```

### Stripe Webhooks (Local Forwarding)

```bash
# In a separate terminal — forwards Stripe events to your local server
stripe listen --forward-to localhost:3000/billing/webhook

# Copy the printed webhook secret (whsec_...) into your .env as STRIPE_WEBHOOK_SECRET
# Then restart the dev server.
```

**Trigger test webhook events:**
```bash
stripe trigger checkout.session.completed
stripe trigger invoice.payment_failed
stripe trigger customer.subscription.deleted
```

---

## 🧠 Design Decisions

The architectural trade-offs that make this system robust — token rotation strategy, Lua atomicity for rate limiting, idempotency key design, webhook source-of-truth pattern — are documented in detail.

👉 **[Read the Architecture Decisions Log (DECISIONS.md)](DECISIONS.md)**

---

## 🗺️ Phase Roadmap

- [x] **Phase 0** — Foundation (Express, PostgreSQL, Redis, Docker)
- [x] **Phase 1** — Auth + Org + RBAC
- [x] **Phase 2** — API Key System
- [x] **Phase 3** — Rate Limiting (Redis sliding window)
- [x] **Phase 4** — Usage Metering
- [x] **Phase 5** — Billing & Webhooks (Stripe)
- [x] **Phase 6** — Polish & Swagger Documentation
- [x] **Phase 7** — Production Hardening (CI/CD, cursor pagination, query analysis, coverage)
