import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';

export const demoReadOnly = (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  
  // Apply sandbox if requested via the Demo User (JWT) OR the Demo Org (API Key)
  const isDemoUser = authReq.user?.email === 'demo@tollgate.io';
  const isDemoOrg = authReq.org_slug === 'demo-org';

  if (!isDemoUser && !isDemoOrg) {
    return next();
  }

  // Always allow GET requests
  if (req.method === 'GET') {
    return next();
  }

  // Explicitly allow specific non-destructive POST requests
  const allowedPaths = ['/auth/login', '/auth/refresh', '/auth/logout'];
  
  // Note: We check req.path. If mounted under a router, req.baseUrl + req.path might be needed,
  // but if mounted globally, req.path is usually sufficient, or we just allow if it matches the end.
  const isAllowedPath = allowedPaths.some(p => req.originalUrl.includes(p));

  if (isAllowedPath && req.method === 'POST') {
    return next();
  }

  // Block any other mutating request
  res.status(403).json({
    error: 'Forbidden',
    message: 'Demo account is read-only. Mutating actions are disabled.'
  });
};
