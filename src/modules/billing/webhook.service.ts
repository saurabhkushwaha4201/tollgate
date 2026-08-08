import { stripe } from '../../config/stripe';
import { db } from '../../config/db';
import Stripe from 'stripe';
import { logger } from '../../config/logger';

// ---------------------------------------------------------------------------
// Main webhook handler — called by the webhook route controller
// ---------------------------------------------------------------------------
export async function handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
  // constructEvent throws if the signature is invalid.
  // We let it propagate — the route controller catches it and returns 400.
  // Never return 200 for an unverified event.
  const event = stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );

  // Route to the specific handler first.
  // Insert into billing_events AFTER the handler succeeds.
  //
  // Why this order matters:
  //   If we insert first and the handler throws, the event is already marked
  //   as processed. Stripe retries, we see the unique violation, and silently
  //   drop it — the actual DB update never happens. Data is lost.
  //
  //   If the handler runs first and billing_events insert fails, Stripe retries.
  //   The handler runs again — all handler DB ops use SET (idempotent, not INCREMENT)
  //   so running twice produces the same result. Then the insert succeeds.
  //   No data corruption.
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'invoice.payment_succeeded':
        await onPaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await onPaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.deleted':
        await onSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        // Unknown event types are fine — Stripe sends many event types we don't care about.
        // Log and fall through to the billing_events insert (good for audit trail).
        // console.log(`[webhook] unhandled event type: ${event.type}`);
        logger.info({ eventType: event.type, context: 'webhook' }, 'unhandled event type');
    }
  } catch (err) {
    // Handler threw — do not insert into billing_events.
    // Stripe will retry. Log the error so it's visible.
    // console.error(`[webhook] handler failed for event ${event.id} (${event.type}):`, err);
    logger.error({ err, eventId: event.id, eventType: event.type, context: 'webhook' }, 'handler failed');
    throw err;
  }

  // Handler succeeded — now mark the event as processed.
  // If this insert throws a unique violation (23505), it means a concurrent
  // delivery already processed this event and beat us to the insert.
  // Both handlers completed successfully — the duplicate insert is harmless.
  try {
    await db.query(
      `INSERT INTO billing_events (org_id, stripe_event_id, event_type, payload)
       VALUES ($1, $2, $3, $4)`,
      [
        extractOrgId(event),
        event.id,
        event.type,
        JSON.stringify(event.data.object),
      ]
    );
  } catch (err: any) {
    if (err.code === '23505') {
      // Unique violation = concurrent delivery, both handlers ran cleanly
      // console.log(`[webhook] duplicate event insert ignored: ${event.id}`);
      logger.info({ eventId: event.id, context: 'webhook' }, 'duplicate event insert ignored');
      return;
    }
    // Any other DB error: log but don't re-throw.
    // The handler succeeded and Stripe already has our 200.
    // A billing_events insert failure is an audit concern, not a data integrity one.
    // console.error(`[webhook] billing_events insert failed for ${event.id}:`, err);
    logger.error({ err, eventId: event.id, context: 'webhook' }, 'billing_events insert failed');
  }
}

// ---------------------------------------------------------------------------
// Event handlers — all DB ops use SET (idempotent), never INCREMENT
// ---------------------------------------------------------------------------

async function onCheckoutCompleted(session: Stripe.Checkout.Session) {
  const orgId = session.metadata?.org_id;
  if (!orgId) {
    // console.warn('[webhook] checkout.session.completed missing org_id in metadata');
    logger.warn({ context: 'webhook' }, 'checkout.session.completed missing org_id in metadata');
    return;
  }

  // Retrieve the full subscription to get the price ID
  const subscription = await stripe.subscriptions.retrieve(
    session.subscription as string
  );
  const priceId  = subscription.items.data[0].price.id;
  const planTier = priceIdToPlanTier(priceId);

  await db.query(
    `UPDATE orgs
     SET plan_tier              = $1,
         stripe_subscription_id = $2,
         payment_status         = 'active'
     WHERE id = $3`,
    [planTier, subscription.id, orgId]
  );

  // console.log(`[webhook] org ${orgId} upgraded to ${planTier}`);
  logger.info({ orgId, planTier, context: 'webhook' }, 'org upgraded');
}

async function onPaymentSucceeded(invoice: Stripe.Invoice) {
  // In Stripe v22, subscription_details moved under invoice.parent.subscription_details.
  // Fall back to customer ID lookup if parent or metadata isn't set.
  const orgId =
    (invoice.parent?.subscription_details?.metadata as any)?.org_id
    ?? await orgIdFromCustomer(invoice.customer as string);

  if (!orgId) {
    // console.warn('[webhook] invoice.payment_succeeded: could not resolve org_id');
    logger.warn({ context: 'webhook' }, 'invoice.payment_succeeded: could not resolve org_id');
    return;
  }

  await db.query(
    `UPDATE orgs SET payment_status = 'active' WHERE id = $1`,
    [orgId]
  );

  // Production extension: if on a metered plan, read usage_summaries
  // for the just-closed billing period and call stripe.subscriptionItems.createUsageRecord()
  // before the invoice finalizes. Phase 5b concern.

  // console.log(`[webhook] org ${orgId} payment succeeded`);
  logger.info({ orgId, context: 'webhook' }, 'org payment succeeded');
}

async function onPaymentFailed(invoice: Stripe.Invoice) {
  const orgId = await orgIdFromCustomer(invoice.customer as string);
  if (!orgId) {
    // console.warn('[webhook] invoice.payment_failed: could not resolve org_id');
    logger.warn({ context: 'webhook' }, 'invoice.payment_failed: could not resolve org_id');
    return;
  }

  // past_due: payment failed but org is still in a grace period.
  // We do not downgrade plan_tier here — that would cut them off.
  // The rate limiter will add X-Billing-Status: past_due to signal the client.
  await db.query(
    `UPDATE orgs SET payment_status = 'past_due' WHERE id = $1`,
    [orgId]
  );

  // Production: send email notification via SendGrid/Resend here.
  // console.log(`[webhook] org ${orgId} payment failed — status set to past_due`);
  logger.info({ orgId, context: 'webhook' }, 'org payment failed — status set to past_due');
}

async function onSubscriptionDeleted(subscription: Stripe.Subscription) {
  const orgId =
    subscription.metadata?.org_id
    ?? await orgIdFromCustomer(subscription.customer as string);

  if (!orgId) {
    // console.warn('[webhook] customer.subscription.deleted: could not resolve org_id');
    logger.warn({ context: 'webhook' }, 'customer.subscription.deleted: could not resolve org_id');
    return;
  }

  // Subscription is definitively over — downgrade to free.
  // This is the only place plan_tier changes to 'free' — not in cancelSubscription().
  // Stripe's event is the source of truth. We trust the webhook, not our own timer.
  await db.query(
    `UPDATE orgs
     SET plan_tier              = 'free',
         stripe_subscription_id = NULL,
         payment_status         = 'canceled'
     WHERE id = $1`,
    [orgId]
  );

  // console.log(`[webhook] org ${orgId} subscription deleted — downgraded to free`);
  logger.info({ orgId, context: 'webhook' }, 'org subscription deleted — downgraded to free');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Extract org_id from event metadata. Different event types attach metadata
// to different objects — this function handles the common case.
function extractOrgId(event: Stripe.Event): string | null {
  const obj = event.data.object as any;
  return obj?.metadata?.org_id ?? null;
}

// Fallback org resolution by stripe_customer_id.
// Used when org_id metadata is absent (e.g., customer created in Stripe Dashboard
// before this app was deployed, or imported from another system).
async function orgIdFromCustomer(customerId: string): Promise<string | null> {
  const result = await db.query(
    'SELECT id FROM orgs WHERE stripe_customer_id = $1',
    [customerId]
  );
  return result.rows[0]?.id ?? null;
}

function priceIdToPlanTier(priceId: string): 'pro' | 'enterprise' | 'free' {
  if (priceId === process.env.STRIPE_PRO_PRICE_ID)        return 'pro';
  if (priceId === process.env.STRIPE_ENTERPRISE_PRICE_ID) return 'enterprise';
  return 'free';
}
