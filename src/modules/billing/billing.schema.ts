import { z } from 'zod';

// Only 'pro' and 'enterprise' are valid upgrade targets.
// 'free' is never a checkout target — you can't pay to go to free.
// Downgrades happen only via the cancel flow.
export const checkoutSchema = z.object({
  targetPlan: z.enum(['pro', 'enterprise']),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
