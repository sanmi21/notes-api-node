import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = process.env.JWT_ISSUER || 'notes-api';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'notes-api';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

function commonOptions(expiresIn) {
  return {
    algorithm: 'HS256',
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER,
    expiresIn
  };
}

export function createAccessToken(userId) {
  return jwt.sign(
    {token_use: 'access'},
    JWT_SECRET,
    {...commonOptions(process.env.JWT_ACCESS_EXPIRES_IN || '30m'), subject: String(userId)}
  );
}

export function createMfaChallengeToken(userId) {
  return jwt.sign(
    {token_use: 'mfa'},
    JWT_SECRET,
    {...commonOptions(process.env.MFA_CHALLENGE_EXPIRES_IN || '5m'), subject: String(userId)}
  );
}

export function verifyToken(token, expectedUse) {
  const payload = jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER
  });

  if (payload.token_use !== expectedUse || !payload.sub) {
    throw new Error('Unexpected token type');
  }

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('Invalid token subject');
  }

  return {...payload, userId};
}
