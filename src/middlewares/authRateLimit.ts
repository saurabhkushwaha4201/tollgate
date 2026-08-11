import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../config/redis';
import { Request } from 'express';

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP+email to 5 requests per `window` (here, per 15 minutes)
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failed logins toward the limit
  skip: (req: Request) => {
    // exempt: demo credentials are intentionally public
    return req.body?.email === 'demo@tollgate.io';
  },
  store: new RedisStore({
    // @ts-expect-error - Known issue with rate-limit-redis types and ioredis, but works at runtime
    sendCommand: (...args: string[]) => redis.call(...args),
  }),
  keyGenerator: (req: Request) => {
    const rawIp = req.ip || req.socket.remoteAddress || 'unknown';
    const ip = ipKeyGenerator(rawIp);
    const email = req.body?.email || 'no-email';
    return `rl:login:${ip}:${email}`;
  },

  message: {
    error: 'Too Many Requests',
    message: 'Too many failed login attempts, please try again after 15 minutes.'
  }
});
