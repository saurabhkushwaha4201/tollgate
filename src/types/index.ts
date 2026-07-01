import { Request } from 'express';

export type PlanTier = 'free' | 'pro' | 'enterprise'
export type Role = 'owner' | 'admin' | 'member'
export type PaymentStatus = 'active' | 'past_due' | 'canceled'

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
  payment_status: PaymentStatus           // 'active' | 'past_due' | 'canceled'
  stripe_customer_id: string | null       // null until first checkout
  stripe_subscription_id: string | null   // null on free plan
  created_at: Date
}

export interface OrgMember {
  user_id: string
  org_id: string
  role: Role
  joined_at: Date
}

// This will gets attached to every authenticated request
export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string
    email: string
  };
  org_id?: string;
  api_key_id?: string;   // set by authenticateApiKey — used for usage_events FK
}

export interface ApiKey {
  id: string;
  org_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  last_used_at: Date | null;
  is_active: boolean;
  created_at: Date;
}