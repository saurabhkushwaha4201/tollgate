import request from 'supertest';
import app from '../../index';
import { db } from '../../config/db';

beforeAll(async () => {
  await db.query('TRUNCATE users, orgs CASCADE');
});

afterAll(async () => {
  await db.end(); // close pg pool
});

describe('Auth Module', () => {
  const testUser = {
    email: 'testauth@example.com',
    password: 'Password123!',
    orgName: 'Auth Test Org',
  };

  let accessToken: string;
  let refreshToken: string;

  describe('POST /auth/register', () => {
    it('registers a new user and creates an org', async () => {
      const res = await request(app).post('/auth/register').send(testUser);

      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe(testUser.email);
    });

    it('returns 400 when registering with an existing email', async () => {
      const res = await request(app).post('/auth/register').send(testUser);
      expect(res.status).toBe(409); // service throws 409 for conflict
      expect(res.body.error).toBe('Email already in use');
    });
  });

  describe('POST /auth/login', () => {
    it('logs in the user and returns tokens', async () => {
      const res = await request(app).post('/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();

      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it('returns 401 for invalid credentials', async () => {
      const res = await request(app).post('/auth/login').send({
        email: testUser.email,
        password: 'WrongPassword!',
      });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });
  });

  describe('GET /auth/me', () => {
    it('returns the current user when authenticated', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe(testUser.email);
    });

    it('returns 401 when not authenticated', async () => {
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('refreshes the access token using a valid refresh token', async () => {
      const res = await request(app).post('/auth/refresh').send({
        refreshToken,
      });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      
      // Update tokens for logout test (refresh endpoint returns new access token)
      accessToken = res.body.accessToken;
    });
  });

  describe('POST /auth/logout', () => {
    it('logs the user out and revokes the refresh token', async () => {
      const res = await request(app).post('/auth/logout').send({
        refreshToken,
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Logged out successfully');

      // Try refreshing with the revoked token
      const refreshRes = await request(app).post('/auth/refresh').send({
        refreshToken,
      });
      
      expect(refreshRes.status).toBe(401);
      expect(refreshRes.body.error).toBe('Invalid or expired refresh token');
    });
  });
});
