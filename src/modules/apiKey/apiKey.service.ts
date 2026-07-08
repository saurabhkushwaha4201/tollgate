import { db } from '../../config/db';
import { generateApiKey, hashApiKey } from '../../utils/apiKey';
import { CreateApiKeyInput } from './apiKey.schema';
import { AppError } from '../../utils/error';
import { logger } from '../../config/logger';

export async function createApiKey(orgId: string, input: CreateApiKeyInput) {
  const { fullKey, prefix, hash } = generateApiKey(input.env);

  const result = await db.query(
    `INSERT INTO api_keys (org_id, name, key_prefix, key_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, key_prefix, created_at`,
    [orgId, input.name, prefix, hash]
  );

  // fullKey returned here and ONLY here — never again
  return {
    ...result.rows[0],
    key: fullKey,
  };
}

export async function listApiKeys(orgId: string) {
  const result = await db.query(
    `SELECT id, name, key_prefix, last_used_at, is_active, created_at
     FROM api_keys
     WHERE org_id = $1
     ORDER BY created_at DESC`,
    [orgId]
  );
  // key_hash is intentionally excluded from SELECT
  return result.rows;
}

export async function revokeApiKey(orgId: string, keyId: string) {
  const result = await db.query(
    `UPDATE api_keys
     SET is_active = false
     WHERE id = $1 AND org_id = $2
     RETURNING id`,
    [keyId, orgId]
  );

  if (result.rowCount === 0) {
    throw new AppError('API key not found', 404);
  }
}

// Used by authenticateApiKey middleware
export async function lookupApiKey(rawKey: string) {
  const hash = hashApiKey(rawKey);

  const result = await db.query(
    `SELECT id, org_id, is_active
     FROM api_keys
     WHERE key_hash = $1`,
    [hash]
  );

  return result.rows[0] ?? null;
}

// Fire-and-forget — called without await in middleware
export function updateLastUsed(keyId: string): void {
  db.query(
    `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
    [keyId]
  ).catch((err: any) => {
    // log but never throw — this must not affect the request
    logger.error({ err, context: 'updateLastUsed' }, 'fire-and-forget update failed');
  });
}
