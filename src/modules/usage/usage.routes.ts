import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { requireRole } from '../../middlewares/requireRole';
import { getUsage, getUsageHistory } from './usage.controller';

const router = Router({ mergeParams: true });  // to access :orgId from parent

// Both routes: JWT-authenticated (dashboard surface, not API-key surface)
// Any org member can view their own org's usage
router.get('/',        authenticate, requireRole('member'), getUsage);
router.get('/history', authenticate, requireRole('member'), getUsageHistory);

export default router;
