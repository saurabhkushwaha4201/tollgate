import { Response, NextFunction } from 'express';
import { lookupApiKey, updateLastUsed } from '../modules/apiKey/apiKey.service';
import { AuthenticatedRequest } from '../types';

export async function authenticateApiKey(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const rawKey = req.headers['x-api-key'];

  if (!rawKey || typeof rawKey !== 'string') {
    return res.status(401).json({ error: 'Missing API key' });
  }

  const apiKey = await lookupApiKey(rawKey);

  if (!apiKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  if (!apiKey.is_active) {
    return res.status(401).json({ error: 'API key has been revoked' });
  }

  // Attach org context — downstream handlers/middleware use this
  req.org_id = apiKey.org_id;
  req.org_slug = apiKey.org_slug;
  req.api_key_id = apiKey.id;   // used by usage metering in rateLimit middleware

  // Fire and forget — no await, no latency added
  updateLastUsed(apiKey.id);

  next();
}
