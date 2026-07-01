import request from 'supertest';
import app from '../../index';
import { db } from '../../config/db';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function registerAndLogin() {
  const ts = Date.now();
  const email = `billing-${ts}@test.com`;

  const reg = await request(app).post('/auth/register').send({
    email,
    password: 'Test1234!',
    orgName: `Billing Test Org ${ts}`,
  });
  if (reg.status !== 201) throw new Error(`Register failed: ${JSON.stringify(reg.body)}`);

  const login = await request(app).post('/auth/login').send({ email, password: 'Test1234!' });
  if (login.status !== 200) throw new Error(`Login failed: ${JSON.stringify(login.body)}`);

  const accessToken: string = login.body.accessToken;

  const userRes = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  const userId: string = userRes.rows[0].id;

  const orgRes = await db.query('SELECT org_id FROM org_members WHERE user_id = $1', [userId]);
  const orgId: string = orgRes.rows[0].org_id;

  return { orgId, accessToken, email };
}

// Register a second user who is NOT a member of the org (for 403 tests)
async function registerStranger() {
  const ts = Date.now();
  const email = `stranger-${ts}@test.com`;
  const reg = await request(app).post('/auth/register').send({
    email,
    password: 'Test1234!',
    orgName: `Stranger Org ${ts}`,
  });
  const login = await request(app).post('/auth/login').send({ email, password: 'Test1234!' });
  return { accessToken: login.body.accessToken as string };
}

afterAll(async () => {
  await db.end();
});

// ─── POST /orgs/:orgId/billing/checkout ───────────────────────────────────────

describe('POST /orgs/:orgId/billing/checkout', () => {
  it('returns 401 without a token', async () => {
    const { orgId } = await registerAndLogin();
    const res = await request(app)
      .post(`/orgs/${orgId}/billing/checkout`)
      .send({ targetPlan: 'pro' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller is not a member of the org', async () => {
    const { orgId } = await registerAndLogin();
    const { accessToken: strangerToken } = await registerStranger();

    const res = await request(app)
      .post(`/orgs/${orgId}/billing/checkout`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ targetPlan: 'pro' });

    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid targetPlan value', async () => {
    const { orgId, accessToken } = await registerAndLogin();

    const res = await request(app)
      .post(`/orgs/${orgId}/billing/checkout`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ targetPlan: 'free' }); // 'free' is not a valid upgrade target

    expect(res.status).toBe(400);
  });

  it('returns 400 when targetPlan is missing', async () => {
    const { orgId, accessToken } = await registerAndLogin();

    const res = await request(app)
      .post(`/orgs/${orgId}/billing/checkout`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  // NOTE: We cannot test a successful checkout session creation here because
  // it requires a real STRIPE_SECRET_KEY and STRIPE_PRO_PRICE_ID to be set.
  // In CI / local test runs without Stripe credentials, this would 500.
  // The happy path is verified manually via stripe CLI trigger.
});

// ─── GET /orgs/:orgId/billing/subscription ────────────────────────────────────

describe('GET /orgs/:orgId/billing/subscription', () => {
  it('returns 401 without a token', async () => {
    const { orgId } = await registerAndLogin();
    const res = await request(app).get(`/orgs/${orgId}/billing/subscription`);
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller is not a member of the org', async () => {
    const { orgId } = await registerAndLogin();
    const { accessToken: strangerToken } = await registerStranger();

    const res = await request(app)
      .get(`/orgs/${orgId}/billing/subscription`)
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 200 with free plan data when org has no Stripe subscription', async () => {
    const { orgId, accessToken } = await registerAndLogin();

    const res = await request(app)
      .get(`/orgs/${orgId}/billing/subscription`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.plan_tier).toBe('free');
    expect(res.body.payment_status).toBe('active');
    expect(res.body.subscription).toBeNull(); // no Stripe subscription on free plan
  });

  it('response shape includes plan_tier, payment_status, and subscription fields', async () => {
    const { orgId, accessToken } = await registerAndLogin();

    const res = await request(app)
      .get(`/orgs/${orgId}/billing/subscription`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('plan_tier');
    expect(res.body).toHaveProperty('payment_status');
    expect(res.body).toHaveProperty('subscription');
  });
});

// ─── POST /orgs/:orgId/billing/cancel ────────────────────────────────────────

describe('POST /orgs/:orgId/billing/cancel', () => {
  it('returns 401 without a token', async () => {
    const { orgId } = await registerAndLogin();
    const res = await request(app).post(`/orgs/${orgId}/billing/cancel`);
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller is not a member of the org', async () => {
    const { orgId } = await registerAndLogin();
    const { accessToken: strangerToken } = await registerStranger();

    const res = await request(app)
      .post(`/orgs/${orgId}/billing/cancel`)
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 400 when org has no active subscription to cancel', async () => {
    const { orgId, accessToken } = await registerAndLogin();

    // New org → free plan → no stripe_subscription_id
    const res = await request(app)
      .post(`/orgs/${orgId}/billing/cancel`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

// ─── POST /billing/webhook ────────────────────────────────────────────────────

describe('POST /billing/webhook', () => {
  it('returns 400 when stripe-signature header is missing', async () => {
    const res = await request(app)
      .post('/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'checkout.session.completed' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when stripe-signature is present but invalid', async () => {
    const res = await request(app)
      .post('/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'invalid_signature_value')
      .send(JSON.stringify({ type: 'checkout.session.completed' }));

    expect(res.status).toBe(400);
  });

  // NOTE: Testing a valid webhook requires constructing a real HMAC signature
  // using STRIPE_WEBHOOK_SECRET. That is covered by the stripe CLI:
  //   stripe trigger checkout.session.completed
  // which forwards a correctly signed event to localhost:3000/billing/webhook.
});

// ─── payment_status enforcement (rate limit middleware) ───────────────────────

describe('payment_status enforcement', () => {
  it('returns 402 when org payment_status is canceled', async () => {
    const { orgId } = await registerAndLogin();

    // Manually set the org to canceled state (simulates subscription.deleted webhook)
    await db.query(
      `UPDATE orgs SET payment_status = 'canceled' WHERE id = $1`,
      [orgId]
    );

    // Create an API key for this org
    const { orgId: _, accessToken } = await registerAndLogin();
    // Use a fresh org's token but the canceled org's API key path
    const keyRes = await request(app)
      .post(`/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Test Key' });

    // The canceled org — create a key directly
    const canceledOrg = await registerAndLogin();
    await db.query(
      `UPDATE orgs SET payment_status = 'canceled' WHERE id = $1`,
      [canceledOrg.orgId]
    );
    const canceledKeyRes = await request(app)
      .post(`/orgs/${canceledOrg.orgId}/api-keys`)
      .set('Authorization', `Bearer ${canceledOrg.accessToken}`)
      .send({ name: 'Canceled Org Key' });

    const apiKey: string = canceledKeyRes.body.data.key;

    const res = await request(app)
      .get('/v1/ping')
      .set('x-api-key', apiKey);

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('Payment Required');
  });

  it('sets X-Billing-Status: past_due header when payment_status is past_due', async () => {
    const { orgId, accessToken } = await registerAndLogin();

    // Manually set to past_due (simulates invoice.payment_failed webhook)
    await db.query(
      `UPDATE orgs SET payment_status = 'past_due' WHERE id = $1`,
      [orgId]
    );

    const keyRes = await request(app)
      .post(`/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Past Due Key' });

    const apiKey: string = keyRes.body.data.key;

    const res = await request(app)
      .get('/v1/ping')
      .set('x-api-key', apiKey);

    // past_due: request goes through, but header warns the client
    expect(res.status).toBe(200);
    expect(res.headers['x-billing-status']).toBe('past_due');
  });

  it('does not set X-Billing-Status header when payment_status is active', async () => {
    const { orgId, accessToken } = await registerAndLogin();

    const keyRes = await request(app)
      .post(`/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Active Key' });

    const apiKey: string = keyRes.body.data.key;

    const res = await request(app)
      .get('/v1/ping')
      .set('x-api-key', apiKey);

    expect(res.status).toBe(200);
    expect(res.headers['x-billing-status']).toBeUndefined();
  });
});
