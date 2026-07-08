# Tollgate — Developer Log

> Personal build log. Not for public consumption.
> Written to explain what was built, why decisions were made, 
> and what was hard — to my future self and for interview prep.

---

## Project Overview

**What it is:**  
A multi-tenant SaaS API backend that handles everything between 
"org signs up" and "org gets invoiced" — auth, API keys, rate limiting, 
usage metering, and Stripe billing.

**Why I built it:**  
To demonstrate production backend thinking beyond CRUD. Every phase 
introduces a real infrastructure concern that shows up in actual SaaS 
products.

**Stack:**  
Node.js · TypeScript · PostgreSQL · Redis · Stripe · Docker Compose

**Pattern throughout:**  
route → controller → service. Middlewares in `src/middlewares/`. 
DB pool as `db`. Error class as `AppError` from `src/utils/error.ts`.

---

## Phase Index

| Phase | Name | Status |
|-------|------|--------|
| 0 | Foundation | ✅ Done |
| 1 | Auth + Org + RBAC | ✅ Done |
| 2 | API Key System | ✅ Done |
| 3 | Rate Limiting | ✅ Done |
| 4 | Usage Metering | ✅ Done |
| 5 | Billing & Webhooks | ✅ Done |
| 6 | Polish & Resume Prep | ✅ Done |

---

## Phase 0 — Foundation

**Date completed:** June 24, 2026  
**Branch:** `phase/0-foundation`

### What I built
- Express + TypeScript project scaffold
- PostgreSQL connected via `pg` Pool
- Redis connected via `ioredis`  
- Docker Compose running both services
- `GET /health` confirming both connections live

### Why it matters
Every subsequent phase assumes these connections exist and are stable. 
Getting Docker Compose right here means I never fight environment 
inconsistencies later.

### Challenges
- Spent an hour fighting Docker networking because the Node container couldn't resolve 'postgres'. Realized I needed to use the service name from docker-compose.yml as the host.

### Decisions
- Used `pg` Pool directly instead of an ORM — wanted full control 
  over query shape, and ORMs hide the SQL that matters for interviews.

### What I'd do differently
- Introduce structured logging (like Pino) from day one instead of relying on basic `console.log`.

---

## Phase 1 — Auth + Org + RBAC

**Date completed:** June 25, 2026  
**Branch:** `phase/1-auth`

### What I built
- User registration, login, refresh, logout, /me
- Org creation tied to registration (single transaction)
- Org member management: invite, role change, remove
- JWT access tokens + SHA-256 hashed refresh tokens
- `requireRole()` middleware factory for RBAC

### Why it matters
This is the foundation every API product sits on. Most backends 
implement auth but get the multi-tenant part wrong — they don't 
enforce org boundaries at the middleware layer.

### The core mental model
Every protected request goes through two checks:
1. Are you authenticated? (`authenticate` middleware — JWT)
2. Do you have the right role in this org? (`requireRole` middleware — DB query)

These are separate concerns handled by separate middleware. 
The role check hits the DB on every request — no role caching. 
Simpler, always consistent.

### Key decisions

**Refresh token storage: hash not plaintext**  
If the DB is compromised, plaintext refresh tokens let an attacker 
impersonate any user indefinitely. SHA-256 hashed tokens mean a DB 
leak gives the attacker useless strings — they need the original token 
which only exists in the HTTP response that was already sent.

**Transaction for register**  
User + org + membership are created in a single `BEGIN/COMMIT`. 
If any step fails, nothing is created. No orphaned users, no orgs 
without owners.

**Identical error for wrong email vs wrong password**  
"Invalid credentials" for both. Returning different messages leaks 
whether an email is registered — useful for attackers enumerating accounts.

**RBAC hierarchy: member < admin < owner**  
`requireRole('admin')` passes for admin AND owner. 
`requireRole('owner')` passes for owner only. 
Implemented as an index comparison on a fixed array — simple, readable.

### Challenges
- Got stuck trying to execute a multi-statement transaction in pg without accidentally leaking the connection back to the pool midway. Forced me to read the pg Pool docs closely on client.query vs pool.query.

### What I'd do differently
- Implement a robust password strength validator (like zxcvbn) at the Zod schema level to prevent weak passwords in production.

---

## Phase 2 — API Key System

**Date completed:** June 26, 2026  
**Branch:** `phase/2-api-keys`

### What I built
- API key generation, listing, revocation endpoints
- `authenticateApiKey` middleware
- `api_keys` table with prefix + hash storage
- Fire-and-forget `last_used_at` tracking

### Why it matters
JWT auth assumes you can run a login flow. Backend-to-backend API 
calls need a static credential. API keys are that credential.

### The anatomy of a key
```
sk_live_a3f9x2b8k1mz9x2b8k1mz9x2b8k1mz
│  │     └── 64 chars of crypto.randomBytes(32).toString('hex')
│  └──────── environment (live/test)
└─────────── type prefix
```

### Key decisions

**SHA-256 not bcrypt**  
bcrypt is slow by design — that's the defense against brute-forcing 
password hashes. API keys are 256 bits of random entropy. There's no 
dictionary to attack. bcrypt's slowness would add ~100ms to every 
API-key-authenticated request for zero security benefit.

**Prefix stored plaintext, full key hashed**  
The prefix (`sk_live_a3f9`) lets users identify which key is which 
in the dashboard without ever seeing the full key again. The full key 
is hashed. The hash is what gets compared on every request.

**Show full key exactly once**  
On creation the response includes the full key. It's never stored. 
After that response is sent, it's gone. Users must copy it immediately.  
This matches how GitHub, Stripe, and every real API does it.

**`updateLastUsed` returns void**  
The function signature is `void` not `Promise<void>`. Callers literally 
cannot accidentally await it. The `.catch()` inside swallows errors 
intentionally — a failed timestamp update must never reject a valid request.

**Soft revocation via `is_active`**  
Setting `is_active = false` rather than deleting the row preserves the 
audit trail. Phase 4 usage_events references `api_key_id` — hard deletes 
would orphan those records.

### Challenges
- Initially tried to store the full API key in plaintext so I could show it in the dashboard later, then realized how insecure that was. Redesigned to only store a prefix for display and hash the full key.

### What I'd do differently
- Implement an automated key rotation policy mechanism and send warnings via email when an API key is nearing its expiration date.

---

## Phase 3 — Rate Limiting

**Date completed:** June 28, 2026  
**Branch:** `phase/3-rate-limiting`

### What I built
- Redis sliding window rate limiter
- Lua script executed via EVALSHA
- Plan-aware limits per org
- `X-RateLimit-*` response headers
- `rate_limit_events` table for Phase 4

### Why it matters
Without rate limiting, any org can exhaust your server. Rate limiting 
is also what makes plan tiers enforceable — free orgs get less 
throughput than pro orgs, enforced in infrastructure not application logic.

### The algorithm

Each request adds an entry to a Redis sorted set keyed by `org_id`. 
Score = timestamp in ms. To check the window:
1. Remove entries with score < `now - windowMs` (sliding part)
2. Count remaining entries (ZCARD)
3. If under limit, add current request (ZADD + PEXPIRE)
4. Return allowed/rejected + current count

### Why sorted sets over INCR+EXPIRE

INCR+EXPIRE implements a fixed window. The window resets on the clock. 
An org can make 60 requests at 11:59:59 and 60 more at 12:00:00 — 
120 requests in 2 seconds against a 60/min limit. 

Sliding window counts the last 60 seconds from *now*, not from the 
last minute boundary. The burst is impossible.

### Why Lua via EVALSHA

The check (ZCARD) and the write (ZADD) must be atomic. Without 
atomicity: two concurrent requests both read count=59, both decide 
they're under the limit, both write. Limit becomes 61.

Lua scripts execute as a single atomic unit in Redis. No interleaving.

EVALSHA vs raw EVAL: SCRIPT LOAD pre-compiles the script on the Redis 
server. Every subsequent call sends a 40-byte SHA instead of the full 
script text. At high request volume this matters.

### NOSCRIPT handling

Redis flushes script cache on restart. Without handling NOSCRIPT errors, 
a Redis restart brings down the API until the process also restarts. 
The service catches NOSCRIPT, clears the cached SHA, reloads the script, 
retries once. First request post-restart takes one extra round-trip. 
Everything after is transparent.

### The middleware ordering guard

If `rateLimit` runs without `req.org_id` being set (wrong middleware 
order), the Redis key becomes `ratelimit:undefined` and all orgs share 
one bucket. The guard returns 500 immediately — surfaces the bug in 
development instead of silently corrupting production data.

### Challenges
- Spent two hours on NOSCRIPT errors in tests — Redis was being restarted between test runs and the cached SHA was stale. Fixed by clearing scriptSha in beforeEach.

### What I'd do differently
- Create a mock testing utility that perfectly simulates time advancement to test sliding windows more deterministically within Jest without `setTimeout` flakiness.

---

## Phase 4 — Usage Metering

**Date completed:** June 29, 2026  
**Branch:** `phase/4-usage-metering`

### What I built
- `usage_events` table — raw per-request log
- `usage_summaries` table — pre-aggregated hourly rollups
- `recordUsageEvent()` called in rateLimit middleware
- Hourly aggregation job with idempotent upsert
- `GET /orgs/:orgId/usage` and `/usage/history` endpoints

### Why it matters
Billing needs to answer "how much did org X consume this period?" 
Without metering, that's a guess. With it, it's deterministic.

### Why two tables

`usage_events` grows to millions of rows at any real traffic volume. 
A billing query spanning 30 days of events is a full table scan.

`usage_summaries` pre-aggregates hourly. The same billing query 
becomes a SUM across ~720 rows (30 days × 24 hours). O(events) 
vs O(periods).

### Idempotent aggregation

`ON CONFLICT (org_id, period_start) DO UPDATE` means the job can 
run twice for the same hour and produce the same result. Server 
restarts can't corrupt the aggregated data.

### `api_key_id ON DELETE SET NULL`

If a key is revoked, the usage history stays. The FK becomes null 
but the event row remains. Billing history is never lost because 
an API key was rotated.

### Challenges
- Wrote the aggregation query as a standard INSERT first, but then it failed on the next run with duplicate keys. Had to learn PostgreSQL's ON CONFLICT DO UPDATE syntax to make it properly idempotent.

### What I'd do differently
- Use `pg_cron` directly inside PostgreSQL for the background worker to ensure true isolation instead of relying on a Node.js `setInterval`.

---

## Phase 5 — Billing & Webhooks

**Date completed:** July 1, 2026  
**Branch:** `phase/5-billing`

### What I built
- Stripe Checkout session creation
- Webhook handler with signature verification
- Subscription read (live Stripe data)
- Cancellation with `cancel_at_period_end`
- Payment status enforcement in rate limiter

### Why it matters
This is where money moves. The previous four phases are 
infrastructure — this phase makes it a product.

### The webhook problem

Stripe delivers events at-least-once. The same event can arrive 
multiple times. `stripe_event_id UNIQUE` in `billing_events` 
handles this at the DB layer — a duplicate delivery hits a unique 
violation (error code 23505), gets caught, returns 200, and is 
silently dropped.

### Handler before insert

The billing_events insert happens AFTER the handler runs, not before. 

If insert-then-handle: handler throws → event permanently marked as 
processed → next Stripe retry silently dropped → billing state never 
updated.

If handle-then-insert: handler throws → event not recorded → Stripe 
retries → handler runs again cleanly (all updates are SET not INCREMENT 
so re-running is safe) → insert succeeds.

### Metadata at three levels

`org_id` is stored in Stripe metadata on the customer, the checkout 
session, AND the subscription.

- `checkout.session.completed` → session metadata
- `invoice.payment_failed` → invoice object → customer lookup  
- `customer.subscription.deleted` → subscription metadata

Different event types expose different Stripe objects. Storing `org_id` 
at all three levels means any event type can resolve back to the org 
without chaining API calls.

### Raw body before express.json()

Stripe's `constructEvent()` verifies an HMAC signature against the 
raw request bytes. `express.json()` parses and discards the raw bytes. 
If `express.json()` runs first on the webhook route, the bytes are gone 
and signature verification always fails. 

The webhook route is registered in `index.ts` before `app.use(express.json())`.

### Cancellation design

`cancel_at_period_end: true` — access continues until the paid period ends. 
DB is NOT updated on cancellation — it waits for `customer.subscription.deleted` 
webhook at actual period end. Stripe is the source of truth, not our code.

### Payment enforcement split

- `past_due` → allow request, set `X-Billing-Status: past_due` header  
  Reason: they're still a customer trying to pay. Blocking hurts conversion.
  
- `canceled` → 402 Payment Required, hard stop  
  Reason: subscription is definitively over. 402 is the semantically 
  correct HTTP status.

### The enforcement loop (why phases 3 and 5 never import each other)

```
Stripe payment succeeds
  → webhook fires → orgs.plan_tier updated
    → next API request → rateLimit reads plan_tier
      → correct limit applied automatically
```

Zero coupling. Phase 3 doesn't know Stripe exists.

### Challenges
- Wasted half a day because Stripe's signature verification kept failing. Turns out `express.json()` was parsing the body and destroying the raw Buffer before the webhook handler saw it.

### What I'd do differently
- Abstract the Stripe implementation into a strict interface so I can easily swap it out or mock it out extensively during unit tests.

---

## Phase 6 — Polish & Resume Prep

**Date completed:** July 8, 2026  
**Branch:** `phase/6-polish`

### What I built
- Pino structured logging and request ID tracing
- Redis circuit breaker (fail-open)
- Graceful shutdown for Express, Postgres, and Redis
- Full lifecycle integration test ("canary")
- Polished documentation and .env files

### Why it matters
A backend isn't production-ready just because the features work. It needs observability (structured JSON logs) to debug issues at scale, and resilience (circuit breaking, graceful shutdown) to handle infrastructure blips without dropping requests or data. 

### Key decisions

**Fail-open circuit breaker**  
If Redis goes down, `checkRateLimit` intercepts the error and returns a bypassed result rather than failing the request. We lose rate limiting temporarily, but the core API stays up. The `X-RateLimit-Bypass: redis_unavailable` header alerts monitoring systems.

**Graceful Shutdown**  
Catching `SIGTERM`/`SIGINT` to call `server.close()` ensures in-flight requests finish cleanly before we shut down the DB and Redis pools, avoiding dropped connections during deploys.

### Challenges
- Ensuring the request logging middleware fired only *after* the response finished (`res.on('finish')`) so it could accurately capture the final HTTP status code and duration.

### What I'd do differently
- Given this is the final phase, I realize I should have set up the `pino` logger and request ID tracing on day one. Refactoring all `console.log` statements at the end is tedious and error-prone.

---

## Cross-Cutting Concerns

### Things true across all phases

**Fire-and-forget pattern**  
Used for: `updateLastUsed`, `recordUsageEvent`, `logRateLimitEvent`  
Always: return `void` not `Promise<void>`, always `.catch()` internally, 
never throw, never add latency to the request path.

**Zod on every request body**  
All input validated at the controller boundary before reaching the service. 
Zod errors caught by global error handler, returned as 400 with field details.

**AppError for known failures**  
`throw new AppError('message', statusCode)` anywhere in service layer. 
Global handler catches it, returns the right status. Unknown errors 
become 500.

**No ORMs**  
Raw SQL throughout. Every query is readable, debuggable, and 
indexable. The absence of an ORM is a deliberate choice, not an 
oversight — it's what makes the SQL decisions explainable in interviews.

---

## Interview Prep

### Questions I can answer with this project

**"Tell me about a technically interesting problem you solved"**  
→ Rate limiter atomicity problem. ZCARD + ZADD race condition. 
  Lua script as solution. EVALSHA optimization.

**"How do you handle idempotency?"**  
→ Two examples: stripe_event_id UNIQUE for webhooks, 
  ON CONFLICT DO UPDATE for aggregation job.

**"Walk me through your auth system"**  
→ JWT access (stateless, 15min) + hashed refresh tokens (stateful, 7d). 
  Why two tokens. Why hash the refresh token.

**"How would you scale this?"**  
→ Aggregation job → separate worker process or pg_cron. 
  Plan tier lookup → Redis cache with invalidation on upgrade. 
  usage_events → partition by month. 
  Rate limit keys → already in Redis, horizontal scaling ready.

**"What would you do differently in production?"**  
→ Structured logging (pino). Request IDs on every log line. 
  Separate worker for aggregation job. 
  Metered billing for usage-based pricing.
  Email on payment failure via Resend/SendGrid.

### Questions I should prepare better for

**"How does your aggregation job handle concurrent runs?"**  
→ Need to think through: two instances running simultaneously could 
  both aggregate the same hour. ON CONFLICT handles the upsert correctly 
  but there's a window where both read the same events. 
  Production answer: advisory lock or job coordinator.

**"What's the failure mode if Redis goes down?"**  
→ Currently: every rate-limited request fails. 
  Production answer: circuit breaker — fail open (allow requests) 
  with logging, rather than bringing down the API.

---

## Open Questions / Future Work

- [ ] Phase 5b: Stripe metered billing for usage-based pricing
- [x] Structured logging with pino
- [x] Request ID middleware
- [x] Graceful shutdown (drain in-flight requests)
- [ ] Partition `usage_events` by month at scale
- [ ] Cache `plan_tier` in Redis with invalidation hook
- [ ] Email notifications on payment failure