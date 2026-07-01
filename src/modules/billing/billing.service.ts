import { stripe } from '../../config/stripe';
import { db } from '../../config/db';
import { AppError } from '../../utils/error';

// Maps plan names to Stripe price IDs stored in env.
// Price IDs are environment-specific (test vs live) — never hardcode them.
const PRICE_MAP: Record<string, string> = {
  pro:        process.env.STRIPE_PRO_PRICE_ID!,
  enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID!,
};

// ---------------------------------------------------------------------------
// Flow 1: Checkout — creates a Stripe Checkout Session for plan upgrade
// ---------------------------------------------------------------------------
export async function createCheckoutSession(
  orgId: string,
  targetPlan: 'pro' | 'enterprise'
) {
  const priceId = PRICE_MAP[targetPlan];
  if (!priceId) throw new AppError('Invalid plan', 400);

  const orgResult = await db.query(
    'SELECT name, stripe_customer_id FROM orgs WHERE id = $1',
    [orgId]
  );
  if (!orgResult.rows[0]) throw new AppError('Org not found', 404);

  let customerId: string = orgResult.rows[0].stripe_customer_id;

  // Create a Stripe customer the first time this org checks out.
  // We store org_id in metadata because webhooks (invoice.*, subscription.*)
  // give us the customer object, not the org — metadata is how we map back.
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: orgResult.rows[0].name,
      metadata: { org_id: orgId },
    });
    customerId = customer.id;

    await db.query(
      'UPDATE orgs SET stripe_customer_id = $1 WHERE id = $2',
      [customerId, orgId]
    );
  }

  // org_id stored in THREE places: customer (above), session metadata, and
  // subscription_data.metadata. Different webhook events expose different objects:
  //   checkout.session.completed  → session.metadata
  //   invoice.payment_succeeded   → invoice.subscription_details.metadata or customer
  //   customer.subscription.*     → subscription.metadata
  // Setting org_id on all three means we can always trace back to the org.
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${process.env.FRONTEND_URL}/billing/cancel`,
    metadata: { org_id: orgId },
    subscription_data: {
      metadata: { org_id: orgId },
    },
  });

  return { url: session.url };
}

// ---------------------------------------------------------------------------
// Flow 2: Subscription read — returns current plan + live Stripe data
// ---------------------------------------------------------------------------
export async function getSubscription(orgId: string) {
  const orgResult = await db.query(
    `SELECT plan_tier, payment_status, stripe_subscription_id
     FROM orgs WHERE id = $1`,
    [orgId]
  );
  if (!orgResult.rows[0]) throw new AppError('Org not found', 404);

  const { plan_tier, payment_status, stripe_subscription_id } = orgResult.rows[0];

  // Free plan orgs have no Stripe subscription — return local data only
  if (!stripe_subscription_id) {
    return {
      plan_tier,
      payment_status,
      subscription: null,
    };
  }

  // Fetch live from Stripe — deliberately not cached.
  // Subscription status is the one piece of data where staleness has a
  // direct financial consequence. If an org cancels and we serve pro-tier
  // data from a stale cache, that is a real problem.
  const subscription = await stripe.subscriptions.retrieve(stripe_subscription_id);

  // In Stripe v22 (billing mode), current_period_start/end moved from the
  // subscription root to the subscription item level.
  const item = subscription.items.data[0];
  const periodStart = item?.current_period_start ?? null;
  const periodEnd   = item?.current_period_end   ?? null;

  return {
    plan_tier,
    payment_status,
    subscription: {
      id:                   subscription.id,
      status:               subscription.status,
      current_period_start: periodStart ? new Date(periodStart * 1000) : null,
      current_period_end:   periodEnd   ? new Date(periodEnd   * 1000) : null,
      cancel_at_period_end: subscription.cancel_at_period_end,
    },
  };
}

// ---------------------------------------------------------------------------
// Flow 3: Cancellation — schedules cancellation at period end
// ---------------------------------------------------------------------------
export async function cancelSubscription(orgId: string) {
  const orgResult = await db.query(
    'SELECT stripe_subscription_id FROM orgs WHERE id = $1',
    [orgId]
  );
  const subId: string | null = orgResult.rows[0]?.stripe_subscription_id;
  if (!subId) throw new AppError('No active subscription', 400);

  // cancel_at_period_end: true — org keeps access until the period ends.
  // Setting false cancels immediately, which is almost never what users expect.
  //
  // We do NOT update plan_tier or payment_status here. We wait for the
  // customer.subscription.deleted webhook to do it. Stripe's event is the
  // source of truth — our local code is not.
  await stripe.subscriptions.update(subId, {
    cancel_at_period_end: true,
  });

  return { message: 'Subscription will cancel at end of billing period' };
}
