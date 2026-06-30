import express, { Request, Response, NextFunction } from 'express'
import dotenv from 'dotenv'
import { db } from './config/db'
import { redis } from './config/redis'
import authRoutes from './modules/auth/auth.routes'
import orgRoutes from './modules/org/org.routes'
import apiKeyRoutes from './modules/apiKey/apiKey.routes'
import { AppError } from './utils/error'
import { ZodError } from 'zod'
dotenv.config()

const app = express()
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
app.use('/orgs/:orgId/api-keys', apiKeyRoutes)

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
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })
}

export default app;