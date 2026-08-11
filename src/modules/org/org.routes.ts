import { Router } from 'express'
import { authenticate } from '../../middlewares/authenticate'
import { demoReadOnly } from '../../middlewares/demoReadOnly'
import { requireRole } from '../../middlewares/requireRole'
import { getOrg, inviteMember, listMembers, updateMemberRole, removeMember } from './org.controller'

const router = Router()

// authenticate runs first on all routes below
router.use(authenticate)
router.use(demoReadOnly)

router.get('/:orgId',                   requireRole('member'), getOrg)
router.get('/:orgId/members',           requireRole('member'), listMembers)
router.post('/:orgId/members/invite',   requireRole('admin'),  inviteMember)
router.patch('/:orgId/members/:uid',    requireRole('owner'),  updateMemberRole)
router.delete('/:orgId/members/:uid',   requireRole('admin'),  removeMember)

export default router