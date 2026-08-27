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

export interface OrgMember {
  id: string;
  email: string;
  role: string;
  joined_at: string;
}

export interface MembersPage {
  members: OrgMember[];
  nextCursor: string | null;
}

export const listOrgMembers = async (
  orgId: string,
  limit: number = 20,
  cursor?: string          // ISO timestamp of joined_at — exclusive lower bound
): Promise<MembersPage> => {
  let rows: OrgMember[];

  if (cursor) {
    // Cursor-based: fetch rows strictly after the cursor timestamp.
    // WHERE joined_at > cursor keeps the scan O(k) regardless of how deep the page is —
    // unlike OFFSET which forces the DB to read and discard all preceding rows first.
    const result = await db.query<OrgMember>(
      `SELECT u.id, u.email, om.role, om.joined_at
       FROM org_members om
       JOIN users u ON u.id = om.user_id
       WHERE om.org_id = $1
         AND om.joined_at > $2
       ORDER BY om.joined_at ASC
       LIMIT $3`,
      [orgId, cursor, limit + 1]   // fetch one extra to detect if a next page exists
    );
    rows = result.rows;
  } else {
    // First page — no cursor supplied
    const result = await db.query<OrgMember>(
      `SELECT u.id, u.email, om.role, om.joined_at
       FROM org_members om
       JOIN users u ON u.id = om.user_id
       WHERE om.org_id = $1
       ORDER BY om.joined_at ASC
       LIMIT $2`,
      [orgId, limit + 1]           // fetch one extra to detect if a next page exists
    );
    rows = result.rows;
  }

  // If we got limit+1 rows, there is a next page. Trim the extra row and
  // return the joined_at of the last *included* row as the next cursor.
  const hasMore = rows.length > limit;
  if (hasMore) rows = rows.slice(0, limit);

  const nextCursor = hasMore ? rows[rows.length - 1].joined_at : null;

  return { members: rows, nextCursor };
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
  newRole: Role,
  requestingUserId: string
) => {
  if (targetUserId === requestingUserId) {
    throw new AppError('Cannot modify your own role', 403)
  }

  if (newRole === 'owner') {
    throw new AppError('Cannot assign owner role via this endpoint', 403)
  }

  const client = await db.connect()

  try {
    await client.query('BEGIN')

    const check = await client.query(
      `SELECT role FROM org_members WHERE user_id = $1 AND org_id = $2 FOR UPDATE`,
      [targetUserId, orgId]
    )
    if (check.rows.length === 0) {
      throw new AppError('Member not found', 404)
    }
    if (check.rows[0].role === 'owner') {
      throw new AppError('Owner role can only be changed via transfer', 403)
    }

    const result = await client.query(
      `UPDATE org_members SET role = $1
       WHERE org_id = $2 AND user_id = $3
       RETURNING *`,
      [newRole, orgId, targetUserId]
    )

    await client.query('COMMIT')
    return result.rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
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