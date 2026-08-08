# 🛣️ Tollgate

> **API infrastructure for multi-tenant SaaS — authentication, rate limiting, usage metering, and Stripe billing in one unified backend.**


## 📖 What it is

Tollgate is a production-grade multi-tenant API backend covering the 
full lifecycle of a SaaS product — from org signup through API key 
issuance, rate limiting, usage metering, and Stripe billing.

## ☁️ Live Deployment

This API is deployed and actively running in the cloud.
- **Live Base URL:** `https://tollgate-api.onrender.com`
- **Cloud Stack:** 
  - Backend hosted on **Render** (Node.js/Express)
  - Database hosted on **Neon** (Serverless PostgreSQL)
  - Caching & Rate Limiting hosted on **Upstash** (Serverless Redis)

### Test the Live API

**1. Health Check (No Auth Required)**
You can hit the live server's health check right now from your terminal to verify the database and cache connections:
```bash
curl -X GET https://tollgate-api.onrender.com/health
```

**2. Authenticate (Demo Account)**
You can generate a live JWT access token using these read-only demo credentials:
- **Email:** `demo@tollgate.io`
- **Password:** `Demo1234!`

*(Note: Make sure to actually register this demo account in your live database!)*

## 💻 Tech Stack

| Layer | Technology | Description |
| :--- | :--- | :--- |
| **Runtime** | Node.js 20 + TypeScript | API server, background aggregation job, webhook handler |
| **Web Framework**| Express 5 | Lightweight routing and middleware management. |
| **Database** | PostgreSQL 16 | Org/user/billing state, usage_events, usage_summaries |
| **Cache & State**| Redis 7 | Sliding window rate limit buckets per org (sorted sets) |
| **Billing** | Stripe | Checkout sessions, subscription lifecycle, webhook events |
| **Infrastructure**| Render, Neon, Upstash, Docker | Cloud serverless deployment & Local container orchestration |

## ✨ Core Features

### 🔐 Auth & Access Control
- **Dual-Token System:** Short-lived JWT access tokens (15 minutes) paired with SHA-256 hashed, database-backed refresh tokens (7 days).
- **Role-Based Access Control (RBAC):** Organization-scoped permissions supporting `member`, `admin`, and `owner` roles.
- **Atomic Onboarding:** Single database transactions ensure a user, their organization, and their membership role are created atomically.

### 🔑 API Key System  
- **High-Performance Verification:** Keys are hashed via SHA-256 for fast, low-latency per-request lookups without the overhead of bcrypt.
- **Secure Display:** A readable prefix is stored for UI display, while the full key is shown to the user exactly once upon creation.
- **Audit-Friendly Revocation:** Soft deletion via an `is_active` flag preserves historical usage and audit trails.

### 🚦 Rate Limiting
- **Sliding Window Algorithm:** Backed by Redis sorted sets (`ZADD`/`ZCARD`), preventing the burst-traffic vulnerabilities of fixed-window counters.
- **Atomic Execution:** Core logic runs inside a Lua script executed atomically via `EVALSHA` to completely eliminate Time-of-Check to Time-of-Use (TOCTOU) race conditions.
- **Plan-Aware Quotas:** Dynamically enforces limits based on Stripe billing tiers (e.g., Free: 60/min, Pro: 600/min).
- **Standardized Headers:** Injects `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` into every API response.

### 📊 Usage Metering
- **Real-Time Logging:** Fast per-request event logging (`usage_events`) for accurate analytics.
- **Background Aggregation:** An hourly cron job asynchronously rolls up raw events into a `usage_summaries` table using idempotent upserts, preventing heavy analytical queries from slowing down the primary API.
- **Billing-Period Context:** Usage queries are strictly aligned with the organization's unique Stripe billing period.

### 💳 Billing & Subscriptions (Stripe)
- **Hosted Checkout:** Utilizes Stripe Checkout to keep the application out of PCI compliance scope.
- **Resilient Webhooks:** Webhook handlers feature strict HMAC signature verification and an idempotent processing pipeline to safely handle Stripe retries.
- **Decoupled Architecture:** Webhooks update the organization's `plan_tier` in the database, allowing the rate limiter to seamlessly adapt to the new tier on the very next request—maintaining zero direct coupling between the billing and rate-limiting modules.

## 🏗️ Data Model

| Table | Purpose |
|---|---|
| users | Authentication identities |
| orgs | Tenant units, owns plan_tier and Stripe state |
| org_members | RBAC join table (user ↔ org ↔ role) |
| refresh_tokens | Hashed refresh token store |
| api_keys | Hashed API credentials per org |
| rate_limit_events | 429 event log feeding usage metering |
| usage_events | Per-request raw event log |
| usage_summaries | Hourly aggregated rollups for billing queries |
| billing_events | Idempotent Stripe webhook audit log |

---

## 🚀 Local Setup

### Prerequisites
- [Docker](https://www.docker.com/) & Docker Compose
- Node.js 20+
- [Stripe CLI](https://stripe.com/docs/stripe-cli) (Required for local webhook testing)

### Installation & Run

```bash
# 1. Clone the repository
git clone https://github.com/yourhandle/tollgate
cd tollgate

# 2. Configure environment
cp .env.example .env         # Update with your actual secrets

# 3. Start local infrastructure (Postgres & Redis)
docker-compose up -d

# 4. Install dependencies and migrate database
npm install
npm run migrate

# 5. Start the development server
npm run dev
```

### Stripe Webhooks (Local Forwarding)

To test billing flows locally, you need to forward Stripe webhook events to your local server:

```bash
# Start the Stripe listener in a separate terminal window
stripe listen --forward-to localhost:3000/billing/webhook

# IMPORTANT: Copy the webhook signing secret it prints (whsec_...) 
# and paste it into your .env file as STRIPE_WEBHOOK_SECRET, then restart the server.
```

**Testing Webhooks Manually:**
```bash
stripe trigger checkout.session.completed
stripe trigger invoice.payment_failed
stripe trigger customer.subscription.deleted
```

---

## 📡 API Reference

<details>
<summary><strong>Auth Endpoints</strong></summary>

```text
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me
```
</details>

<details>
<summary><strong>Organizations & Members Endpoints</strong></summary>

```text
GET    /orgs/:orgId
GET    /orgs/:orgId/members
POST   /orgs/:orgId/members/invite
PATCH  /orgs/:orgId/members/:uid
DELETE /orgs/:orgId/members/:uid
```
</details>

<details>
<summary><strong>API Keys Endpoints</strong></summary>

```text
POST   /orgs/:orgId/api-keys
GET    /orgs/:orgId/api-keys
DELETE /orgs/:orgId/api-keys/:keyId
```
</details>

<details>
<summary><strong>Usage Metering Endpoints</strong></summary>

```text
GET    /orgs/:orgId/usage
GET    /orgs/:orgId/usage/history
```
</details>

<details>
<summary><strong>Billing & Stripe Endpoints</strong></summary>

```text
POST   /orgs/:orgId/billing/checkout
GET    /orgs/:orgId/billing/subscription
POST   /orgs/:orgId/billing/cancel
POST   /billing/webhook              ← Internal (Stripe only)
```
</details>

---

## 🧠 Design Decisions

The architectural and engineering trade-offs that make this system robust are thoroughly documented. This is the document that separates Tollgate from a standard tutorial project.

👉 **[Read the Architecture Decisions Log (DECISIONS.md)](DECISIONS.md)**

---

## 🗺️ Phase Roadmap

- [x] **Phase 0** — Foundation (Express, PostgreSQL, Redis, Docker)
- [x] **Phase 1** — Auth + Org + RBAC
- [x] **Phase 2** — API Key System
- [x] **Phase 3** — Rate Limiting (Redis sliding window)
- [x] **Phase 4** — Usage Metering
- [x] **Phase 5** — Billing & Webhooks (Stripe)
- [x] **Phase 6** — Polish & Resume Prep
