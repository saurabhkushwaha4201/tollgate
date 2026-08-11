import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { demoReadOnly } from '../../middlewares/demoReadOnly';
import { requireRole } from '../../middlewares/requireRole';
import * as apiKeyController from './apiKey.controller';

const router = Router({ mergeParams: true }); // mergeParams to access :orgId from parent

router.post('/',
  authenticate,
  demoReadOnly,
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
  demoReadOnly,
  requireRole('admin'),
  apiKeyController.revokeApiKey
);

export default router;
