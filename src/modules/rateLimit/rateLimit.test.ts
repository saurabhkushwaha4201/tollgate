import request from 'supertest';
import app from '../../index';
import { db } from '../../config/db';
import { redis } from '../../config/redis';

// Helper
async function setupOrgWithKey() {
  const timestamp = Date.now();
  const email = `rl-${timestamp}@test.com`;

  const regRes = await request(app).post('/auth/register').send({
    email,
    password: 'Test1234!',
    orgName: `Rate Limit Test Org ${timestamp}`,
  });
  if (regRes.status !== 201) throw new Error(`Register failed: ${JSON.stringify(regRes.body)}`);

  const login = await request(app).post('/auth/login').send({ email, password: 'Test1234!' });
  if (login.status !== 200) throw new Error(`Login failed: ${JSON.stringify(login.body)}`);
  
  const accessToken = login.body.accessToken;

  // Get user and org directly from DB
  const userRes = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  const userId = userRes.rows[0].id;
  
  const orgRes = await db.query('SELECT org_id FROM org_members WHERE user_id = $1', [userId]);
  const orgId = orgRes.rows[0].org_id;

  const keyRes = await request(app)
    .post(`/orgs/${orgId}/api-keys`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Test Key' });

  return { orgId, apiKey: keyRes.body.data.key as string, accessToken };
}

afterAll(async () => {
  await db.end();
  await redis.quit();
});

// ─── Response headers ─────────────────────────────────────────────────────────

describe('X-RateLimit-* headers', () => {
  it('returns all three headers on a successful request', async () => {
    const { apiKey } = await setupOrgWithKey();

    const res = await request(app)
      .get('/v1/ping')
      .set('x-api-key', apiKey);

    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('remaining decrements with each request', async () => {
    const { apiKey, orgId } = await setupOrgWithKey();
    // Clear any existing window
    await redis.del(`ratelimit:${orgId}`);

    const first = await request(app).get('/v1/ping').set('x-api-key', apiKey);
    const second = await request(app).get('/v1/ping').set('x-api-key', apiKey);

    const remainingFirst = parseInt(first.headers['x-ratelimit-remaining']);
    const remainingSecond = parseInt(second.headers['x-ratelimit-remaining']);

    expect(remainingSecond).toBe(remainingFirst - 1);
  });
});

// ─── 429 behaviour ────────────────────────────────────────────────────────────

describe('Rate limit enforcement', () => {
  it('returns 429 after limit is exhausted and includes Retry-After', async () => {
    const { apiKey, orgId } = await setupOrgWithKey();

    // Force the org to "free" plan (60 req/min) — then overwrite Redis counter
    // to simulate a nearly-full window without making 60 real requests
    const now = Date.now();
    const pipeline = redis.pipeline();
    for (let i = 0; i < 60; i++) {
      pipeline.zadd(`ratelimit:${orgId}`, now - i * 100, `fake-req-${i}`);
    }
    pipeline.pexpire(`ratelimit:${orgId}`, 60_000);
    await pipeline.exec();

    const res = await request(app)
      .get('/v1/ping')
      .set('x-api-key', apiKey);

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.body.error).toBe('Too Many Requests');
  });

  it('sets X-RateLimit-Remaining to 0 on a 429', async () => {
    const { apiKey, orgId } = await setupOrgWithKey();

    // Same setup as above — fill the window
    const now = Date.now();
    const pipeline = redis.pipeline();
    for (let i = 0; i < 60; i++) {
      pipeline.zadd(`ratelimit:${orgId}`, now - i * 100, `fake-req-${i}`);
    }
    pipeline.pexpire(`ratelimit:${orgId}`, 60_000);
    await pipeline.exec();

    const res = await request(app).get('/v1/ping').set('x-api-key', apiKey);

    expect(parseInt(res.headers['x-ratelimit-remaining'])).toBe(0);
  });
});

// ─── Middleware ordering ──────────────────────────────────────────────────────

describe('Middleware order guard', () => {
  it('returns 401 without x-api-key (authenticateApiKey fires before rateLimit)', async () => {
    const res = await request(app).get('/v1/ping');
    expect(res.status).toBe(401);
  });
});

// ─── rate_limit_events table ─────────────────────────────────────────────────

describe('rate_limit_events logging', () => {
  it('inserts a row when a request is rejected', async () => {
    const { apiKey, orgId } = await setupOrgWithKey();

    // Fill the window
    const now = Date.now();
    const pipeline = redis.pipeline();
    for (let i = 0; i < 60; i++) {
      pipeline.zadd(`ratelimit:${orgId}`, now - i * 100, `fake-req-${i}`);
    }
    pipeline.pexpire(`ratelimit:${orgId}`, 60_000);
    await pipeline.exec();

    await request(app).get('/v1/ping').set('x-api-key', apiKey);

    // Give the fire-and-forget a tick to complete
    await new Promise(r => setTimeout(r, 100));

    const result = await db.query(
      'SELECT * FROM rate_limit_events WHERE org_id = $1',
      [orgId]
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0].endpoint).toBe('/ping');
  });
});
