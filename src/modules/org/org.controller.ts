import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import * as orgService from './org.service'
import type { Role } from '../../types'

const inviteSchema = z.object({
    email: z.string().email(),
    role: z.enum(['admin', 'member'])
})

const updateRoleSchema = z.object({
    role: z.enum(['admin', 'member'])
})

export const getOrg = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const org = await orgService.getOrgById(req.params.orgId as string)
        res.json(org)
    } catch (err) { next(err) }
}

export const listMembers = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const orgId = req.params.orgId as string;

        // Parse cursor (opaque ISO timestamp) and limit from query params
        const cursor = typeof req.query.cursor === 'string' && req.query.cursor
            ? req.query.cursor
            : undefined;
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

        const { members, nextCursor } = await orgService.listOrgMembers(orgId, limit, cursor);

        res.json({
            data: members,
            pagination: {
                limit,
                nextCursor,   // null = no more pages; non-null = pass as ?cursor= on next request
            },
        });
    } catch (err) { next(err) }
}

export const inviteMember = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, role } = inviteSchema.parse(req.body)
        const result = await orgService.inviteUserToOrg(req.params.orgId as string, email, role)
        res.status(201).json(result)
    } catch (err) { next(err) }
}

export const updateMemberRole = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { role } = updateRoleSchema.parse(req.body)
        const requestingUserId = (req as any).user.userId
        const result = await orgService.updateMemberRoleInOrg(
            req.params.orgId as string, req.params.uid as string, role, requestingUserId
        )
        res.json(result)
    } catch (err) { next(err) }
}

export const removeMember = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await orgService.removeMemberFromOrg(
            req.params.orgId as string, req.params.uid as string
        )
        res.json(result)
    } catch (err) { next(err) }
}