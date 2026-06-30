export type PlanTier = 'free' | 'pro' | 'enterprise'
export type Role = 'owner' | 'admin' | 'member'

export interface User {
  id: string
  email: string
  created_at: Date
}

export interface Org {
  id: string
  name: string
  slug: string
  plan_tier: PlanTier
  created_at: Date
}

export interface OrgMember {
  user_id: string
  org_id: string
  role: Role
  joined_at: Date
}

// This will gets attached to every authenticated request
export interface AuthenticatedRequest extends Express.Request {
  user: {
    id: string
    email: string
  }
}