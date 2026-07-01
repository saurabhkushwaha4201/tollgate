import { Request, Response, NextFunction } from 'express';
import { handleWebhook } from './webhook.service';

export async function webhookController(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const signature = req.headers['stripe-signature'];

  if (!signature || typeof signature !== 'string') {
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  try {
    // req.body is a Buffer here because the route uses rawBody middleware
    await handleWebhook(req.body as Buffer, signature);

    // Always return 200 after successful processing.
    // Stripe retries any non-200 response for up to 72 hours.
    // Never let an internal error return a 500 from this endpoint —
    // a 500 triggers retries and you will double-process the event.
    res.status(200).json({ received: true });
  } catch (err: any) {
    // Signature verification failure — this is a legitimate 400
    if (err?.type === 'StripeSignatureVerificationError') {
      res.status(400).json({ error: 'Invalid webhook signature' });
      return;
    }

    // Handler failed — return 400 so Stripe retries.
    // We deliberately do NOT return 500 here. 500 also triggers retries
    // but signals our infrastructure is down. 400 is cleaner and still retries.
    console.error('[webhook] processing error:', err);
    res.status(400).json({ error: 'Webhook processing failed' });
  }
}
