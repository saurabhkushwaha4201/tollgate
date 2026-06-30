import { z } from 'zod';

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(255),
  env: z.enum(['live', 'test']).default('live'),
});

export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;
