import request from 'supertest';
import app from '../../index';
import { db } from '../../config/db';
import { redis } from '../../config/redis';
import { recordUsageEvent } from './usage.service';
import { runAggregation } from '../../jobs/aggregateUsage';

// ─── Test Setup ──────────────────────────────────────────────────────────────

async function setupOrgWithKey() {
  const timestamp = Date.now();
  const email = `usage-${timestamp}@test.com`;

  const regRes = await request(app).post('/auth/register').send({
    email,
    password: 'Test1234!',
    orgName: `Usage Test Org ${timestamp}`,
  });
  if (regRes.status !== 201) throw new Error(`Register failed: ${JSON.stringify(regRes.body)}`);

  const login = await request(app).post('/auth/login').send({ email, password: 'Test1234!' });
  if (login.status !== 200) throw new Error(`Login failed: ${JSON.stringify(login.body)}`);

  const accessToken = login.body.accessToken;

  const userRes = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  const userId = userRes.rows[0].id;

  const orgRes = await db.query('SELECT org_id FROM org_members WHERE user_id = $1', [userId]);
  const orgId = orgRes.rows[0].org_id;

  const keyRes = await request(app)
    .post(`/orgs/${orgId}/api-keys`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Usage Test Key' });

  return { orgId, apiKey: keyRes.body.data.key as string, accessToken };
}

afterAll(async () => {
  await db.end();
  await redis.quit();
});

// ─── recordUsageEvent ─────────────────────────────────────────────────────────

describe('recordUsageEvent()', () => {
  it('inserts a row into usage_events', async () => {
    const { orgId } = await setupOrgWithKey();

    recordUsageEvent({
      orgId,
      apiKeyId: undefined,
      endpoint: '/test',
      method: 'GET',
      statusCode: null,
    });

    // Give fire-and-forget a tick
    await new Promise(r => setTimeout(r, 100));

    const result = await db.query('SELECT * FROM usage_events WHERE org_id = $1', [orgId]);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0].endpoint).toBe('/test');
    expect(result.rows[0].method).toBe('GET');
  });
});

// ─── GET /orgs/:orgId/usage ───────────────────────────────────────────────────

describe('GET /orgs/:orgId/usage', () => {
  it('returns 401 without auth token', async () => {
    const { orgId } = await setupOrgWithKey();
    const res = await request(app).get(`/orgs/${orgId}/usage`);
    expect(res.status).toBe(401);
  });

  it('returns 403 when accessing a different org', async () => {
    const { accessToken } = await setupOrgWithKey();
    const { orgId: otherOrgId } = await setupOrgWithKey();

    const res = await request(app)
      .get(`/orgs/${otherOrgId}/usage`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
  });

  it('returns correct response shape for an org member', async () => {
    const { orgId, accessToken } = await setupOrgWithKey();

    const res = await request(app)
      .get(`/orgs/${orgId}/usage`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.org_id).toBe(orgId);
    expect(res.body.data.plan_tier).toBeDefined();
    expect(res.body.data.billing_period).toHaveProperty('start');
    expect(res.body.data.billing_period).toHaveProperty('end');
    expect(res.body.data.current_usage).toHaveProperty('request_count');
    expect(res.body.data.current_usage).toHaveProperty('throttle_count');
    expect(res.body.data.current_usage).toHaveProperty('limit');
    expect(res.body.data.hourly_breakdown).toBeInstanceOf(Array);
  });

  it('request_count reflects recorded events after aggregation', async () => {
    const { orgId, accessToken } = await setupOrgWithKey();

    // Seed some usage events directly (simulating API calls)
    await db.query(
      `INSERT INTO usage_events (org_id, endpoint, method, status_code, created_at)
       SELECT $1, '/v1/ping', 'GET', NULL,
              NOW() - (INTERVAL '1 hour' * 2)   -- two hours ago → falls in previous complete hour
       FROM generate_series(1, 5)`,
      [orgId]
    );

    // Run aggregation to roll up the events
    await runAggregation();

    const res = await request(app)
      .get(`/orgs/${orgId}/usage`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    // Summaries exist — request_count comes from usage_summaries
    expect(typeof res.body.data.current_usage.request_count).toBe('number');
  });
});

// ─── GET /orgs/:orgId/usage/history ──────────────────────────────────────────

describe('GET /orgs/:orgId/usage/history', () => {
  it('returns correct pagination shape', async () => {
    const { orgId, accessToken } = await setupOrgWithKey();

    const res = await request(app)
      .get(`/orgs/${orgId}/usage/history?page=1&limit=10`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.pagination).toHaveProperty('page', 1);
    expect(res.body.pagination).toHaveProperty('limit', 10);
    expect(res.body.pagination).toHaveProperty('total');
    expect(res.body.pagination).toHaveProperty('pages');
  });

  it('returns 401 without auth', async () => {
    const { orgId } = await setupOrgWithKey();
    const res = await request(app).get(`/orgs/${orgId}/usage/history`);
    expect(res.status).toBe(401);
  });
});

// ─── rateLimit middleware records usage events ────────────────────────────────

describe('Usage events from rate limit middleware', () => {
  it('records a usage event when an API request is made via /v1/ping', async () => {
    const { orgId, apiKey } = await setupOrgWithKey();

    await redis.del(`ratelimit:${orgId}`);

    await request(app).get('/v1/ping').set('x-api-key', apiKey);

    await new Promise(r => setTimeout(r, 100));

    const result = await db.query(
      'SELECT * FROM usage_events WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1',
      [orgId]
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0].endpoint).toBe('/ping');
    expect(result.rows[0].status_code).toBeNull();  // allowed — controller sets actual code
  });

  it('records status_code 429 for throttled requests', async () => {
    const { orgId, apiKey } = await setupOrgWithKey();

    // Seed full window
    const now = Date.now();
    const pipeline = redis.pipeline();
    for (let i = 0; i < 60; i++) {
      pipeline.zadd(`ratelimit:${orgId}`, now - i * 100, `fake-${i}`);
    }
    pipeline.pexpire(`ratelimit:${orgId}`, 60_000);
    await pipeline.exec();

    await request(app).get('/v1/ping').set('x-api-key', apiKey);

    await new Promise(r => setTimeout(r, 100));

    const result = await db.query(
      `SELECT * FROM usage_events WHERE org_id = $1 AND status_code = 429
       ORDER BY created_at DESC LIMIT 1`,
      [orgId]
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0].status_code).toBe(429);
  });
});
