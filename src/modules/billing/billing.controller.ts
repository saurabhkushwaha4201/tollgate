import { Request, Response, NextFunction } from 'express';
import { checkoutSchema } from './billing.schema';
import {
  createCheckoutSession,
  getSubscription,
  cancelSubscription,
} from './billing.service';

export async function handleCheckout(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { targetPlan } = checkoutSchema.parse(req.body);
    // Express 5 types params as string | string[] — assert string since this is a route param
    const result = await createCheckoutSession(req.params.orgId as string, targetPlan);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function handleGetSubscription(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const result = await getSubscription(req.params.orgId as string);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function handleCancelSubscription(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const result = await cancelSubscription(req.params.orgId as string);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
