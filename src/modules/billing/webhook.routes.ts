import { Router } from 'express';
import { webhookController } from './webhook.controller';

const router = Router();

// POST /billing/webhook
// No authentication middleware — Stripe doesn't send auth headers.
// Security is handled inside webhookController via stripe.webhooks.constructEvent()
// which verifies the HMAC signature using STRIPE_WEBHOOK_SECRET.
//
// NOTE: This route must be mounted BEFORE app.use(express.json()) in index.ts.
// The rawBody middleware is applied at the mount point in index.ts, not here,
// so that the correct body parser is scoped only to this route.
router.post('/', webhookController);

export default router;
