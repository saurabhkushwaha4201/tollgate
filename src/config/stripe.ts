import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is required');
}

// apiVersion is pinned to the version shipped with the installed stripe package (v22).
// Never use 'latest' — Stripe releases new API versions that reshape field names and
// object shapes. Pinned = only changes when you explicitly update and test against it.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-06-24.dahlia',
});
