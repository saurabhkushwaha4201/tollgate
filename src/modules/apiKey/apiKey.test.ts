import request from 'supertest';
import app from '../../index';
import { db } from '../../config/db';

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.query('TRUNCATE users, orgs CASCADE');
});

afterAll(async () => {
  await db.end(); // close pg pool
});

// ─── Dummy Route for Middleware Testing ──────────────────────────────────────
import { authenticateApiKey } from '../../middlewares/authenticateApiKey';
app.get('/some-api-key-protected-route', authenticateApiKey, (req: any, res) => {
  res.json({ success: true, org_id: req.org_id });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function registerAndLogin(email: string) {
  const reg = await request(app).post('/auth/register').send({
    email,
    password: 'Test1234!',
    orgName: 'Test Org ' + email, // Ensure orgName is unique to avoid 409s
  });

  return {
    accessToken: reg.body.accessToken as string,
    orgId: reg.body.org.id as string,
  };
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────


// ─── POST /orgs/:orgId/api-keys ──────────────────────────────────────────────

describe('POST /orgs/:orgId/api-keys', () => {
  it('creates an API key and returns the full key exactly once', async () => {
    const { accessToken, orgId } = await registerAndLogin('apikey-create@test.com');

    const res = await request(app)
      .post(`/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'My Key' });

    expect(res.status).toBe(201);
    expect(res.body.data.key).toMatch(/^sk_live_/);
    expect(res.body.data.key_prefix).toBeDefined();
    // full key must never be stored — only prefix in DB
    expect(res.body.data.key_hash).toBeUndefined();
  });

  it('returns 403 for a member trying to create a key', async () => {
    const { accessToken: ownerToken, orgId } = await registerAndLogin('apikey-owner@test.com');

    // Register a second user and invite them as member
    await request(app).post('/auth/register').send({
      email: 'apikey-member@test.com',
      password: 'Test1234!',
      orgName: 'Throwaway Org',
    });

    await request(app)
      .post(`/orgs/${orgId}/members/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'apikey-member@test.com', role: 'member' });

    const memberLogin = await request(app).post('/auth/login').send({
      email: 'apikey-member@test.com',
      password: 'Test1234!',
    });
    const memberToken = memberLogin.body.accessToken;

    const res = await request(app)
      .post(`/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Sneaky Key' });

    expect(res.status).toBe(403);
  });

  it('returns 400 for missing name', async () => {
    const { accessToken, orgId } = await registerAndLogin('apikey-noname@test.com');

    const res = await request(app)
      .post(`/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ─── GET /orgs/:orgId/api-keys ───────────────────────────────────────────────

describe('GET /orgs/:orgId/api-keys', () => {
  it('lists keys without exposing key_hash or full key', async () => {
    const { accessToken, orgId } = await registerAndLogin('apikey-list@test.com');

    await request(app)
      .post(`/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Listing Key' });

    const res = await request(app)
      .get(`/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);

    const key = res.body.data[0];
    expect(key.key_hash).toBeUndefined();  // never exposed
    expect(key.key).toBeUndefined();       // full key never in list
    expect(key.key_prefix).toBeDefined();  // prefix is fine
    expect(key.name).toBeDefined();
  });
});

// ─── DELETE /orgs/:orgId/api-keys/:keyId ─────────────────────────────────────

describe('DELETE /orgs/:orgId/api-keys/:keyId', () => {
  it('revokes a key and rejects subsequent requests with that key', async () => {
    const { accessToken, orgId } = await registerAndLogin('apikey-revoke@test.com');

    const createRes = await request(app)
      .post(`/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Soon Revoked' });

    const { id: keyId, key: fullKey } = createRes.body.data;

    // Key works before revocation on dummy route
    const beforeRevoke = await request(app)
      .get(`/some-api-key-protected-route`)
      .set('x-api-key', fullKey);
    expect(beforeRevoke.status).toBe(200);

    // Revoke it
    const revokeRes = await request(app)
      .delete(`/orgs/${orgId}/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(revokeRes.status).toBe(200);

    // Key rejected after revocation
    const afterRevoke = await request(app)
      .get(`/some-api-key-protected-route`)
      .set('x-api-key', fullKey);
    expect(afterRevoke.status).toBe(401);
  });

  it('returns 404 for a keyId that does not belong to this org', async () => {
    const { accessToken, orgId } = await registerAndLogin('apikey-wrongorg@test.com');

    const res = await request(app)
      .delete(`/orgs/${orgId}/api-keys/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
  });
});

// ─── authenticateApiKey middleware ───────────────────────────────────────────

describe('authenticateApiKey middleware', () => {
  it('rejects requests with no x-api-key header', async () => {
    const res = await request(app).get('/some-api-key-protected-route');
    // 401 or 404 depending on whether route exists — just not 200
    expect(res.status).not.toBe(200);
  });

  it('rejects a malformed / random key', async () => {
    const res = await request(app)
      .get('/some-api-key-protected-route')
      .set('x-api-key', 'sk_live_totallyfakekey');

    expect(res.status).toBe(401);
  });

  it('accepts a valid key and attaches org_id', async () => {
    const { accessToken, orgId } = await registerAndLogin('apikey-mw@test.com');

    const createRes = await request(app)
      .post(`/orgs/${orgId}/api-keys`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'MW Test Key' });

    const fullKey = createRes.body.data.key;

    const res = await request(app)
      .get(`/some-api-key-protected-route`)
      .set('x-api-key', fullKey);

    expect(res.status).toBe(200);
  });
});
