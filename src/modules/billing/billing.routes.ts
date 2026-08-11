import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { demoReadOnly } from '../../middlewares/demoReadOnly';
import { requireRole } from '../../middlewares/requireRole';
import {
  handleCheckout,
  handleGetSubscription,
  handleCancelSubscription,
} from './billing.controller';

const router = Router();

// POST /orgs/:orgId/billing/checkout
router.post(
  '/:orgId/billing/checkout',
  authenticate,
  demoReadOnly,
  requireRole('owner'),
  handleCheckout
);

// GET /orgs/:orgId/billing/subscription
router.get(
  '/:orgId/billing/subscription',
  authenticate,
  requireRole('member'),
  handleGetSubscription
);

// POST /orgs/:orgId/billing/cancel
router.post(
  '/:orgId/billing/cancel',
  authenticate,
  demoReadOnly,
  requireRole('owner'),
  handleCancelSubscription
);

export default router;
