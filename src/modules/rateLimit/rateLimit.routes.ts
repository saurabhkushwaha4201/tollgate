import { Router } from 'express';
import { authenticateApiKey } from '../../middlewares/authenticateApiKey';
import { demoReadOnly } from '../../middlewares/demoReadOnly';
import { rateLimit } from '../../middlewares/rateLimit';
import { AuthenticatedRequest } from '../../types';
import { Response } from 'express';

const router = Router();

// Apply API key authentication and the demo read-only sandbox to all /v1 routes
router.use(authenticateApiKey);
router.use(demoReadOnly);

// A simple echo endpoint — just for testing the rate limiter
router.get('/ping',
  rateLimit,
  (req: AuthenticatedRequest, res: Response) => {
    res.json({
      org_id: req.org_id,
      timestamp: new Date().toISOString(),
    });
  }
);

export default router;
