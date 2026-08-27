import request from 'supertest';
import app from '../index';
import { db } from '../config/db';
import { redis } from '../config/redis';
import Stripe from 'stripe';

// ---------------------------------------------------------------------------
// Helper — register a fresh org and return credentials
// ---------------------------------------------------------------------------
async function registerAndLogin(suffix = '') {
  const ts = Date.now();
  const email = `lifecycle${suffix}-${ts}@test.com`;

  const registerRes = await request(app).post('/auth/register').send({
    email,
    password: 'Password123!',
    orgName: `Lifecycle Org ${ts}`,
  });
  if (registerRes.status !== 201) {
    throw new Error(`Register failed: ${JSON.stringify(registerRes.body)}`);
  }

  const loginRes = await request(app).post('/auth/login').send({
    email,
    password: 'Password123!',
  });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${JSON.stringify(loginRes.body)}`);
  }

  const accessToken: string = loginRes.body.accessToken;

  // Resolve orgId from DB — avoids depending on login response shape
  const userRes = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  const userId: string = userRes.rows[0].id;
  const orgRes = await db.query('SELECT org_id FROM org_members WHERE user_id = $1', [userId]);
  const orgId: string = orgRes.rows[0].org_id;

  return { accessToken, orgId, email };
}

// ---------------------------------------------------------------------------
// Teardown — close connections so Jest exits cleanly
// ---------------------------------------------------------------------------
afterAll(async () => {
  await db.end();
  await redis.quit();
});

// ---------------------------------------------------------------------------
// Full org lifecycle — the canary test
//
// Covers: register → create API key → rate-limited ping → usage event logged
//         → webhook (invoice.payment_failed) → payment_status updated in DB
// ---------------------------------------------------------------------------
describe('Full org lifecycle', () => {
  it(
    'register → API key → ping → usage event logged → webhook updates payment_status',
    async () => {
      // ── 1. Register and log in ──────────────────────────────────────────
      const { accessToken, orgId } = await registerAndLogin();

      // ── 2. Create an API key ────────────────────────────────────────────
      const keyRes = await request(app)
        .post(`/orgs/${orgId}/api-keys`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Lifecycle Key' });

      expect(keyRes.status).toBe(201);
      const apiKey: string = keyRes.body.data.key;
      expect(typeof apiKey).toBe('string');
      expect(apiKey.length).toBeGreaterThan(0);

      // ── 3. Hit /v1/ping with the API key (rate limit middleware runs) ───
      const pingRes = await request(app)
        .get('/v1/ping')
        .set('x-api-key', apiKey);

      expect(pingRes.status).toBe(200);
      expect(pingRes.headers['x-ratelimit-limit']).toBeDefined();
      expect(pingRes.headers['x-ratelimit-remaining']).toBeDefined();
      expect(pingRes.headers['x-ratelimit-reset']).toBeDefined();

      // ── 4. Verify usage_events got a row (fire-and-forget, allow a tick) ─
      await new Promise(r => setTimeout(r, 150));

      const usageRows = await db.query(
        'SELECT * FROM usage_events WHERE org_id = $1',
        [orgId]
      );
      expect(usageRows.rows.length).toBeGreaterThan(0);
      expect(usageRows.rows[0].api_key_id).toBeDefined();
      expect(usageRows.rows[0].endpoint).toBe('/ping');

      // ── 5. Webhook: invoice.payment_failed ─────────────────────────────
      //
      // Strategy: use stripe.webhooks.generateTestHeaderString() to produce a
      // valid HMAC-SHA256 signature without a real Stripe account.
      // We temporarily override STRIPE_WEBHOOK_SECRET with a local test secret,
      // construct the signed raw body, send it, then restore the env var.
      //
      // invoice.payment_failed was chosen because its handler only does:
      //   UPDATE orgs SET payment_status = 'past_due'
      // — no outbound Stripe API calls, so no credentials needed.
      //
      const TEST_WEBHOOK_SECRET = 'whsec_test_lifecycle_secret_1234567890';
      const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
      process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

      // Build a minimal invoice.payment_failed payload.
      // The handler resolves org_id via orgIdFromCustomer (customer column lookup),
      // so we seed the org's stripe_customer_id with a fake value that matches.
      const fakeCustomerId = `cus_test_lifecycle_${orgId.slice(0, 8)}`;
      await db.query(
        'UPDATE orgs SET stripe_customer_id = $1 WHERE id = $2',
        [fakeCustomerId, orgId]
      );

      // Construct the minimal event payload matching Stripe's shape
      const eventPayload = {
        id: `evt_test_lifecycle_${Date.now()}`,
        object: 'event',
        type: 'invoice.payment_failed',
        data: {
          object: {
            object: 'invoice',
            id: `in_test_${Date.now()}`,
            customer: fakeCustomerId,
            // parent.subscription_details path (Stripe v22 shape)
            parent: null,
          },
        },
      };

      const rawBody = JSON.stringify(eventPayload);
      const timestamp = Math.floor(Date.now() / 1000);

      // Generate the signature exactly as stripe.webhooks.constructEvent() expects
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload: rawBody,
        secret: TEST_WEBHOOK_SECRET,
        timestamp,
      });

      const webhookRes = await request(app)
        .post('/billing/webhook')
        .set('Content-Type', 'application/octet-stream')
        .set('stripe-signature', signature)
        .send(Buffer.from(rawBody));

      // Restore the original secret before any assertions that might throw
      process.env.STRIPE_WEBHOOK_SECRET = originalSecret;

      expect(webhookRes.status).toBe(200);
      expect(webhookRes.body.received).toBe(true);

      // ── 6. Verify the DB reflects the webhook's side-effect ────────────
      const orgRow = await db.query(
        'SELECT payment_status FROM orgs WHERE id = $1',
        [orgId]
      );
      expect(orgRow.rows[0].payment_status).toBe('past_due');

      // ── 7. Verify idempotency — sending the same event again is a no-op ─
      const duplicateRes = await request(app)
        .post('/billing/webhook')
        .set('Content-Type', 'application/octet-stream')
        .set('stripe-signature', signature)
        .send(Buffer.from(rawBody));

      // 200 because we silently drop duplicates (unique constraint on stripe_event_id)
      expect(duplicateRes.status).toBe(200);

      // payment_status must not have changed — still past_due, not something else
      const orgRowAfterDupe = await db.query(
        'SELECT payment_status FROM orgs WHERE id = $1',
        [orgId]
      );
      expect(orgRowAfterDupe.rows[0].payment_status).toBe('past_due');
    },
    30_000 // allow up to 30s for live Neon + Upstash round-trips
  );
});
