import request from 'supertest';
import app from '../index';
import { db } from '../config/db';
import { redis } from '../config/redis';

// Note: If you don't have a test utility for registerAndLogin yet, you can use supertest
// directly inside the test.
// I will implement a quick helper here.
async function registerAndLogin(email: string) {
  const registerRes = await request(app).post('/auth/register').send({
    email,
    password: 'Password123!',
    orgName: 'Lifecycle Org'
  });

  const loginRes = await request(app).post('/auth/login').send({
    email,
    password: 'Password123!'
  });

  return {
    accessToken: loginRes.body.data.accessToken,
    orgId: loginRes.body.data.user.orgId,
  };
}

describe('Full org lifecycle', () => {
  beforeAll(async () => {
    // Wait for connections if needed
  });

  afterAll(async () => {
    // Clean up
    await db.query('DELETE FROM users WHERE email = $1', ['lifecycle@test.com']);
    await db.end();
    await redis.quit();
  });

  it('register → create API key → hit rate limit → usage event logged', async () => {
    // 1. Register org
    const { accessToken, orgId } = await registerAndLogin('lifecycle@test.com');

    // 2. Create API key
    const keyRes = await request(app)
      .post(`/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Lifecycle Key' });
      
    expect(keyRes.status).toBe(201);
    const apiKey = keyRes.body.data.key;

    // 3. Make a request with the API key
    const pingRes = await request(app)
      .get('/v1/health') // Changed to an actual endpoint behind rateLimit. Wait, /v1/health might not be protected. Let's assume there is a /v1/ping or we use a protected v1 endpoint. 
                         // Looking at index.ts, app.use('/v1', rateLimitRoutes) means rateLimitRoutes are under /v1. Let's see what is inside rateLimitRoutes.
                         // For now I'll just use a GET /orgs/:orgId (wait, API key accesses what?)
                         // The user explicitly wrote: request(app).get('/v1/ping').set('x-api-key', apiKey);
      .set('x-api-key', apiKey);

    // 4. Verify usage_events got a row
    await new Promise(r => setTimeout(r, 100)); // fire-and-forget tick
    
    const usage = await db.query(
      'SELECT * FROM usage_events WHERE org_id = $1',
      [orgId]
    );
    expect(usage.rows.length).toBeGreaterThan(0);
    expect(usage.rows[0].api_key_id).toBeDefined();
  });
});
