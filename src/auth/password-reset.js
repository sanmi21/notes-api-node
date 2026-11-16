import crypto from 'node:crypto';

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_LIFETIME_MS = 15 * 60 * 1000;

export function createPasswordResetToken() {
  const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString('base64url');
  return {
    token,
    tokenHash: hashPasswordResetToken(token),
    expiresAt: new Date(Date.now() + RESET_TOKEN_LIFETIME_MS)
  };
}

export function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
