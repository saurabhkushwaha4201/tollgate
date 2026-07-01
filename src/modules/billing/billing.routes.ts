import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { requireRole } from '../../middlewares/requireRole';
import {
  handleCheckout,
  handleGetSubscription,
  handleCancelSubscription,
} from './billing.controller';

const router = Router();

// Routes are defined as /:orgId/billing/... so this router can be mounted
// at /orgs in index.ts — matching the pattern used by the existing org routes.
// Mounting at /orgs here means Express sees: /orgs + /:orgId/billing/... = correct path.

// POST /orgs/:orgId/billing/checkout
// owner-only: billing mutations affect all org members, only the owner can initiate
router.post(
  '/:orgId/billing/checkout',
  authenticate,
  requireRole('owner'),
  handleCheckout
);

// GET /orgs/:orgId/billing/subscription
// member-level read: all members should be able to see billing state
router.get(
  '/:orgId/billing/subscription',
  authenticate,
  requireRole('member'),
  handleGetSubscription
);

// POST /orgs/:orgId/billing/cancel
// owner-only: same reasoning as checkout
router.post(
  '/:orgId/billing/cancel',
  authenticate,
  requireRole('owner'),
  handleCancelSubscription
);

export default router;
