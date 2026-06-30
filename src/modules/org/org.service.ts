import { db } from '../../config/db'
import { AppError } from '../../utils/error'
import type { Role } from '../../types'

export const getOrgById = async (orgId: string) => {
  const result = await db.query(
    `SELECT id, name, slug, plan_tier, created_at FROM orgs WHERE id = $1`,
    [orgId]
  )
  if (result.rows.length === 0) throw new AppError('Org not found', 404)
  return result.rows[0]
}

export const listOrgMembers = async (orgId: string) => {
  const result = await db.query(
    `SELECT u.id, u.email, om.role, om.joined_at
     FROM org_members om
     JOIN users u ON u.id = om.user_id
     WHERE om.org_id = $1
     ORDER BY om.joined_at ASC`,
    [orgId]
  )
  return result.rows
}

export const inviteUserToOrg = async (orgId: string, email: string, role: Role) => {
  // Find user by email
  const userResult = await db.query(
    `SELECT id FROM users WHERE email = $1`, [email]
  )
  if (userResult.rows.length === 0) {
    throw new AppError('No user found with that email', 404)
  }
  const userId = userResult.rows[0].id

  // Check not already a member
  const existing = await db.query(
    `SELECT 1 FROM org_members WHERE user_id = $1 AND org_id = $2`,
    [userId, orgId]
  )
  if (existing.rows.length > 0) {
    throw new AppError('User is already a member of this org', 409)
  }

  // Add member
  await db.query(
    `INSERT INTO org_members (user_id, org_id, role) VALUES ($1, $2, $3)`,
    [userId, orgId, role]
  )

  return { message: `${email} added as ${role}` }
}

export const updateMemberRoleInOrg = async (
  orgId: string,
  targetUserId: string,
  newRole: Role
) => {
  // Prevent owner role assignment 
  if (newRole === 'owner') {
    throw new AppError('Cannot assign owner role via this endpoint', 403)
  }

  const result = await db.query(
    `UPDATE org_members SET role = $1
     WHERE org_id = $2 AND user_id = $3
     RETURNING *`,
    [newRole, orgId, targetUserId]
  )
  if (result.rows.length === 0) throw new AppError('Member not found', 404)
  return result.rows[0]
}

export const removeMemberFromOrg = async (orgId: string, targetUserId: string) => {
  // Prevent removing the owner
  const check = await db.query(
    `SELECT role FROM org_members WHERE user_id = $1 AND org_id = $2`,
    [targetUserId, orgId]
  )
  if (check.rows[0]?.role === 'owner') {
    throw new AppError('Cannot remove the org owner', 403)
  }

  await db.query(
    `DELETE FROM org_members WHERE user_id = $1 AND org_id = $2`,
    [targetUserId, orgId]
  )
  return { message: 'Member removed' }
}