import jwt from 'jsonwebtoken'
import crypto from 'crypto'

const JWT_SECRET =
  process.env.JWT_SECRET

if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET not defined"
  )
}

const REFRESH_SECRET = process.env.REFRESH_SECRET

if (!REFRESH_SECRET) {
  throw new Error(
    "REFRESH_SECRET not defined"
  )
}

const JWT_EXPIRES_IN = '15m'

interface TokenPayload {
  userId: string
  email: string
}

export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(token, JWT_SECRET) as TokenPayload
}

export const generateRefreshToken = (): string => {
  return crypto.randomBytes(64).toString('hex')
}

export const hashRefreshToken = (token: string): string => {
  // Using HMAC since we have a secret available
  return crypto.createHmac('sha256', REFRESH_SECRET).update(token).digest('hex')
}