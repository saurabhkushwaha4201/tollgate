import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { requireRole } from '../../middlewares/requireRole';
import * as apiKeyController from './apiKey.controller';

const router = Router({ mergeParams: true }); // mergeParams to access :orgId from parent

router.post('/',
  authenticate,
  requireRole('admin'),
  apiKeyController.createApiKey
);

router.get('/',
  authenticate,
  requireRole('member'),
  apiKeyController.listApiKeys
);

router.delete('/:keyId',
  authenticate,
  requireRole('admin'),
  apiKeyController.revokeApiKey
);

export default router;
