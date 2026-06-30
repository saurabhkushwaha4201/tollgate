import crypto from 'crypto';

export interface GeneratedApiKey {
  fullKey: string;    // returned to user ONCE, never stored
  prefix: string;     // stored plaintext for display
  hash: string;       // stored in DB for verification
}

export function generateApiKey(env: 'live' | 'test' = 'live'): GeneratedApiKey {
  const random = crypto.randomBytes(32).toString('hex'); // 64 char hex
  const fullKey = `sk_${env}_${random}`;
  const prefix = fullKey.substring(0, 12);              // "sk_live_a3f9"
  const hash = crypto.createHash('sha256').update(fullKey).digest('hex');

  return { fullKey, prefix, hash };
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}
