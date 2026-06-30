import { Request, Response, NextFunction } from 'express'
import { db } from '../config/db'
import { AppError } from '../utils/error'
import type { Role } from '../types'

const ROLE_LEVEL: Record<Role, number> = {
  member: 1,
  admin: 2,
  owner: 3
}

const hasPermission = (
  userRole: Role,
  requiredRole: Role
) => {

  return ROLE_LEVEL[userRole]
       >= ROLE_LEVEL[requiredRole]

}

// This is a middleware factory — it returns a middleware function
export const requireRole = (requiredRole: Role) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.userId
      const orgId = req.params.orgId

      if (!orgId) {
        return next(new AppError('Org ID missing from route', 400))
      }

      // Check membership + role in one query
      const result = await db.query(
        `SELECT role FROM org_members
         WHERE user_id = $1 AND org_id = $2`,
        [userId, orgId]
      )

      if (result.rows.length === 0) {
        return next(new AppError('You are not a member of this org', 403))
      }

      const userRole = result.rows[0].role as Role

      if (!hasPermission(userRole, requiredRole)) {
        return next(new AppError(
          `This action requires ${requiredRole} role or above`, 403
        ))
      }

      // Attach role to request for use in controllers if needed
      ;(req as any).orgRole = userRole

      next()
    } catch (err) {
      next(err)
    }
  }
}