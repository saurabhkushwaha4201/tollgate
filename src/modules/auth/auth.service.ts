// Authentication logic
import { db } from '../../config/db'
import { hashPassword, comparePassword } from '../../utils/hash'
import { generateAccessToken, generateRefreshToken, hashRefreshToken } from '../../utils/token'
import { generateSlug } from '../../utils/slug'
import { AppError } from '../../utils/error'
import type { RegisterInput, LoginInput } from './auth.schema'

// Helper — saves refresh token to DB
const saveRefreshToken = async (userId: string, token: string) => {
  const tokenHash = hashRefreshToken(token)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  )
}

export const registerUser = async (input: RegisterInput) => {
  const { email, password, orgName } = input

  // Check if email already exists
  const existing = await db.query(
    'SELECT id FROM users WHERE email = $1',
    [email]
  )
  if (existing.rows.length > 0) {
    throw new AppError('Email already in use', 409)
  }

  const password_hash = await hashPassword(password)

  const slug = generateSlug(orgName)

  // Check slug uniqueness
  const slugCheck = await db.query(
    'SELECT id FROM orgs WHERE slug = $1',
    [slug]
  )
  if (slugCheck.rows.length > 0) {
    throw new AppError('Org name already taken', 409)
  }

  // Run transaction — all three inserts or none
  const client = await db.connect()

  try {
    await client.query('BEGIN')

    const userResult = await client.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, created_at`,
      [email, password_hash]
    )
    const user = userResult.rows[0]

    const orgResult = await client.query(
      `INSERT INTO orgs (name, slug)
       VALUES ($1, $2)
       RETURNING id, name, slug, plan_tier, created_at`,
      [orgName, slug]
    )
    const org = orgResult.rows[0]

    await client.query(
      `INSERT INTO org_members (user_id, org_id, role)
       VALUES ($1, $2, 'owner')`,
      [user.id, org.id]
    )

    await client.query('COMMIT')

    const accessToken = generateAccessToken({ userId: user.id, email: user.email })
    const refreshToken = generateRefreshToken()
    await saveRefreshToken(user.id, refreshToken)

    return { user, org, accessToken, refreshToken }

  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()   // always return connection to pool
  }
}

export const loginUser = async (input: LoginInput) => {
  const { email, password } = input

  // Find user
  const result = await db.query(
    `SELECT id, email, password_hash FROM users WHERE email = $1`,
    [email]
  )
  const user = result.rows[0]

  if (!user) {
    throw new AppError('Invalid credentials', 401)
  }

  const valid = await comparePassword(password, user.password_hash)
  if (!valid) {
    throw new AppError('Invalid credentials', 401)
  }

  const accessToken = generateAccessToken({ userId: user.id, email: user.email })
  const refreshToken = generateRefreshToken()
  await saveRefreshToken(user.id, refreshToken)

  return {
    user: { id: user.id, email: user.email },
    accessToken,
    refreshToken
  }
}

export const refreshAccessToken = async (rawRefreshToken: string) => {
  const tokenHash = hashRefreshToken(rawRefreshToken)

  // Find token in DB
  const result = await db.query(
    `SELECT rt.*, u.email FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1 AND rt.expires_at > NOW()`,
    [tokenHash]
  )

  if (result.rows.length === 0) {
    throw new AppError('Invalid or expired refresh token', 401)
  }

  const { user_id, email } = result.rows[0]

  // Issue new access token
  const accessToken = generateAccessToken({ userId: user_id, email })
  return { accessToken }
}

export const logoutUser = async (rawRefreshToken: string) => {
  const tokenHash = hashRefreshToken(rawRefreshToken)

  await db.query(
    `DELETE FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash]
  )
}

// For user details
export const getMe = async (userId: string) => {
  const result = await db.query(
    `SELECT u.id, u.email, u.created_at,
            json_agg(json_build_object(
              'org_id', o.id,
              'org_name', o.name,
              'role', om.role
            )) AS orgs
     FROM users u
     LEFT JOIN org_members om ON om.user_id = u.id
     LEFT JOIN orgs o ON o.id = om.org_id
     WHERE u.id = $1
     GROUP BY u.id`,
    [userId]
  )
  return result.rows[0]
}