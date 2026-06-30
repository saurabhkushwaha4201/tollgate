// Validation schemas for incoming request bodies
import { z } from 'zod'

export const registerSchema = z.object({
    email: z.email({
        error: "Invalid email format"
    }),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    orgName: z.string().min(2, 'Org name must be at least 2 characters')
})

export const loginSchema = z.object({
    email: z.email({
        error: "Invalid email format"
    }),
    password: z.string().min(1, 'Password is required')
})

// These infer TypeScript types from the zod schemas automatically
export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>

export const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1, 'Refresh token is required')
})

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>