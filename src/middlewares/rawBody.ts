import express from 'express';

// Use this middleware on the webhook route INSTEAD OF express.json().
//
// Why: Stripe's constructEvent() verifies the webhook payload using an HMAC
// signature over the raw request bytes. express.json() parses and discards
// those raw bytes — once gone, signature verification always fails.
//
// This must be registered on /billing/webhook BEFORE app.use(express.json())
// in index.ts. Middleware ordering is load-bearing here.
export const rawBody = express.raw({ type: 'application/json' });
