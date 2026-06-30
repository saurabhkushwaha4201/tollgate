import { Router } from 'express';
import { authenticateApiKey } from '../../middlewares/authenticateApiKey';
import { rateLimit } from '../../middlewares/rateLimit';
import { AuthenticatedRequest } from '../../types';
import { Response } from 'express';

const router = Router();

// A simple echo endpoint — just for testing the rate limiter
router.get('/ping',
  authenticateApiKey,
  rateLimit,
  (req: AuthenticatedRequest, res: Response) => {
    res.json({
      org_id: req.org_id,
      timestamp: new Date().toISOString(),
    });
  }
);

export default router;
