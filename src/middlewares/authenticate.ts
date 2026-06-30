import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../utils/token'
import { AppError } from '../utils/error'

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  // token from header
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('No token provided', 401))
  }

  const token = authHeader.split(' ')[1]  // "Bearer <token>" → "<token>"

  try {
    const decoded = verifyAccessToken(token)
    // @ts-ignore - Assuming req.user is being added for subsequent middlewares
    req.user = decoded
    next()
  } catch (err) {
    return next(new AppError('Invalid or expired token', 401))
  }
}