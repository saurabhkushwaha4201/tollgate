import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: [
    'req.headers.authorization',
    'req.headers["x-api-key"]',
    'req.body.password',
    'req.body.refreshToken',
    'res.headers["set-cookie"]'
  ],
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,   // production: raw JSON to stdout
});
