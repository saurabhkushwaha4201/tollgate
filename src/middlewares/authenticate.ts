import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../utils/token'
import { AppError } from '../utils/error'
import { redis } from '../config/redis'

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  // token from header
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('No token provided', 401))
  }

  const token = authHeader.split(' ')[1]  // "Bearer <token>" → "<token>"

  try {
    const decoded = verifyAccessToken(token)
    
    // Check if token is blacklisted
    if (decoded.jti) {
      const isBlacklisted = await redis.get(`blacklist:${decoded.jti}`)
      if (isBlacklisted) {
        return next(new AppError('Token has been revoked', 401))
      }
    }

    // @ts-ignore - Assuming req.user is being added for subsequent middlewares
    req.user = decoded
    next()
  } catch (err) {
    return next(new AppError('Invalid or expired token', 401))
  }
}