import { Request, Response, NextFunction } from 'express';
import * as apiKeyService from './apiKey.service';
import { CreateApiKeySchema } from './apiKey.schema';
import { AuthenticatedRequest } from '../../types';

export async function createApiKey(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const input = CreateApiKeySchema.parse(req.body);
    const key = await apiKeyService.createApiKey(req.params.orgId as string, input);
    res.status(201).json({
      message: 'API key created. Save this key — it will not be shown again.',
      data: key,
    });
  } catch (err) {
    next(err);
  }
}

export async function listApiKeys(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const keys = await apiKeyService.listApiKeys(req.params.orgId as string);
    res.json({ data: keys });
  } catch (err) {
    next(err);
  }
}

export async function revokeApiKey(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await apiKeyService.revokeApiKey(req.params.orgId as string, req.params.keyId as string);
    res.json({ message: 'API key revoked' });
  } catch (err) {
    next(err);
  }
}
