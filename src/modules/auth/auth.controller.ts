import { Request, Response, NextFunction } from 'express'
import { registerSchema, loginSchema, refreshTokenSchema } from './auth.schema'
import { registerUser, loginUser, getMe, refreshAccessToken, logoutUser } from './auth.service'

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = registerSchema.parse(req.body)
    const result = await registerUser(input)
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
}

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = loginSchema.parse(req.body)
    const result = await loginUser(input)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export const refresh = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = refreshTokenSchema.parse(req.body)
    const result = await refreshAccessToken(refreshToken)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = refreshTokenSchema.parse(req.body)
    
    // Extract access token if provided
    let accessToken: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      accessToken = authHeader.split(' ')[1];
    }

    await logoutUser(refreshToken, accessToken)
    res.json({ message: 'Logged out successfully' })
  } catch (err) {
    next(err)
  }
}

export const me = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user
    const result = await getMe(user.userId)
    res.json(result)
  } catch (err) {
    next(err)
  }
}