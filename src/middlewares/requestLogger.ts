import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { logger } from '../config/logger';

export function requestLogger(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on('finish', () => {
    logger.info({
      requestId: req.requestId,
      method:    req.method,
      path:      req.path,
      status:    res.statusCode,
      duration:  Date.now() - start,
      orgId:     req.org_id,
    });
  });

  next();
}
