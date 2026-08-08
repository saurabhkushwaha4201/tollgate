import express, { Request, Response, NextFunction } from 'express'
import dotenv from 'dotenv'
import { db } from './config/db'
import { redis } from './config/redis'
import authRoutes from './modules/auth/auth.routes'
import orgRoutes from './modules/org/org.routes'
import apiKeyRoutes from './modules/apiKey/apiKey.routes'
import rateLimitRoutes from './modules/rateLimit/rateLimit.routes'
import usageRoutes from './modules/usage/usage.routes'
import billingRoutes from './modules/billing/billing.routes'
import webhookRouter from './modules/billing/webhook.routes'
import { rawBody } from './middlewares/rawBody'
import { startAggregationJob } from './jobs/aggregateUsage'
import { AppError } from './utils/error'
import { ZodError } from 'zod'
import { logger } from './config/logger'
import { requestId } from './middlewares/requestId'
import { requestLogger } from './middlewares/requestLogger'
dotenv.config()

const app = express()

app.use(requestId)
app.use(requestLogger)

// ⚠️  WEBHOOK ROUTE MUST BE REGISTERED BEFORE express.json()
// Stripe's signature verification requires the raw request bytes.
// express.json() parses and discards them — once gone, constructEvent() always fails.
// The rawBody middleware uses express.raw() to preserve the Buffer on req.body.
app.use('/billing/webhook', rawBody, webhookRouter)

// Global JSON parser for all other routes
app.use(express.json())

app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1')        // postgres check
    await redis.ping()                 // redis check
    res.json({ status: 'ok', postgres: 'connected', redis: 'connected' })
  } catch (err) {
    res.status(500).json({ status: 'error', error: String(err) })
  }
})
app.use('/auth', authRoutes)
app.use('/orgs', orgRoutes)
app.use('/orgs', billingRoutes)          // billing routes: /:orgId/billing/...
app.use('/orgs/:orgId/api-keys', apiKeyRoutes)
app.use('/orgs/:orgId/usage', usageRoutes)
app.use('/v1', rateLimitRoutes)


// Global error handler — must have 4 params for Express to recognize it
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map(e => ({
        field: e.path.join('.'),
        message: e.message
      }))
    })
  }

  // Our custom errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message })
  }

  // Unknown errors
  // console.error(err)
  logger.error({ err }, 'Internal server error')
  res.status(500).json({ error: 'Internal server error' })
})
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    // console.log(`Server running on port ${PORT}`)
    logger.info({ port: PORT }, 'Tollgate API started')
  })
  
  startAggregationJob()
  
  async function shutdown(signal: string) {
    logger.info({ signal }, 'Shutdown signal received');

    server.close(async () => {
      logger.info('HTTP server closed — draining connections');

      try {
        await db.end();
        logger.info('PostgreSQL pool closed');
      } catch (err) {
        logger.error({ err }, 'Error closing PostgreSQL pool');
      }

      try {
        await redis.quit();
        logger.info('Redis connection closed');
      } catch (err) {
        logger.error({ err }, 'Error closing Redis connection');
      }

      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

export default app;