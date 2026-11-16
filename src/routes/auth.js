import express from 'express';
import bcrypt from 'bcryptjs';
import {generateSecret, generateURI, verify as verifyTotp} from 'otplib';
import prisma from '../db.js';
import {authenticateToken} from '../middleware.js';
import {createAccessToken, createMfaChallengeToken, verifyToken} from '../auth/tokens.js';
import {createPasswordResetToken, hashPasswordResetToken} from '../auth/password-reset.js';
import {sendPasswordResetEmail} from '../services/email.service.js';

const router = express.Router();
const PASSWORD_HASH_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const GENERIC_RESET_MESSAGE = 'If that email is registered, a password reset message has been prepared.';

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must not exceed ${MAX_PASSWORD_LENGTH} characters`;
  }
  return null;
}

function accessTokenResponse(userId) {
  return {
    access_token: createAccessToken(userId),
    token_type: 'Bearer',
    expires_in: 1800
  };
}

router.post('/signup', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const {password} = req.body || {};

    if (!isValidEmail(email)) {
      return res.status(400).json({error: 'A valid email is required'});
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({error: passwordError});
    }

    const existingUser = await prisma.user.findUnique({where: {email}});
    if (existingUser) {
      return res.status(409).json({error: 'Email already registered'});
    }

    const hashedPassword = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
    const newUser = await prisma.user.create({data: {email, password: hashedPassword}});

    return res.status(201).json({id: newUser.id, email: newUser.email});
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({error: 'Email already registered'});
    }
    console.error('Signup error:', error);
    return res.status(500).json({error: 'Internal server error'});
  }
});

router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const {password} = req.body || {};

    if (!email || typeof password !== 'string') {
      return res.status(400).json({error: 'Email and password are required'});
    }

    const user = await prisma.user.findUnique({where: {email}});
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({error: 'Invalid credentials'});
    }

    if (user.mfaEnabled) {
      return res.json({
        mfa_required: true,
        mfa_token: createMfaChallengeToken(user.id),
        expires_in: 300
      });
    }

    return res.json({...accessTokenResponse(user.id), mfa_required: false});
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({error: 'Internal server error'});
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    let debugToken;

    if (isValidEmail(email)) {
      const user = await prisma.user.findUnique({where: {email}});
      if (user) {
        const reset = createPasswordResetToken();
        await prisma.user.update({
          where: {id: user.id},
          data: {
            passwordResetTokenHash: reset.tokenHash,
            passwordResetExpiresAt: reset.expiresAt
          }
        });
        await sendPasswordResetEmail({to: user.email, token: reset.token});
        debugToken = reset.token;
      }
    }

    const response = {message: GENERIC_RESET_MESSAGE};
    if (process.env.NODE_ENV !== 'production' && process.env.AUTH_EXPOSE_TEST_TOKENS === 'true') {
      response.reset_token = debugToken || null;
    }
    return res.json(response);
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({error: 'Internal server error'});
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const {token, password} = req.body || {};
    if (typeof token !== 'string' || !token) {
      return res.status(400).json({error: 'Reset token is required'});
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({error: passwordError});
    }

    const tokenHash = hashPasswordResetToken(token);
    const user = await prisma.user.findFirst({
      where: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: {gt: new Date()}
      },
      select: {id: true}
    });

    if (!user) {
      return res.status(400).json({error: 'Reset token is invalid or expired'});
    }

    const hashedPassword = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
    const updated = await prisma.user.updateMany({
      where: {
        id: user.id,
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: {gt: new Date()}
      },
      data: {
        password: hashedPassword,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null
      }
    });

    if (updated.count !== 1) {
      return res.status(400).json({error: 'Reset token is invalid or expired'});
    }

    return res.json({message: 'Password reset successful. Please log in with the new password.'});
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({error: 'Internal server error'});
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: {id: req.user.userId},
    select: {id: true, email: true, mfaEnabled: true}
  });

  if (!user) {
    return res.status(401).json({error: 'User no longer exists'});
  }

  return res.json({id: user.id, email: user.email, mfa_enabled: user.mfaEnabled});
});

router.post('/mfa/setup', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({where: {id: req.user.userId}});
    if (!user) return res.status(401).json({error: 'User no longer exists'});
    if (user.mfaEnabled) return res.status(409).json({error: 'MFA is already enabled'});

    const secret = generateSecret();
    const otpauthUri = generateURI({issuer: 'Notes API', label: user.email, secret});
    await prisma.user.update({where: {id: user.id}, data: {mfaSecret: secret}});

    return res.json({
      message: 'Add this account to your authenticator app, then confirm with a current 6-digit code.',
      secret,
      otpauth_uri: otpauthUri
    });
  } catch (error) {
    console.error('MFA setup error:', error);
    return res.status(500).json({error: 'Internal server error'});
  }
});

router.post('/mfa/enable', authenticateToken, async (req, res) => {
  try {
    const {code} = req.body || {};
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({error: 'A 6-digit authenticator code is required'});
    }

    const user = await prisma.user.findUnique({where: {id: req.user.userId}});
    if (!user?.mfaSecret) return res.status(400).json({error: 'Start MFA setup first'});
    if (user.mfaEnabled) return res.status(409).json({error: 'MFA is already enabled'});

    const result = await verifyTotp({secret: user.mfaSecret, token: code, epochTolerance: 30});
    if (!result.valid) return res.status(401).json({error: 'Invalid authenticator code'});

    await prisma.user.update({where: {id: user.id}, data: {mfaEnabled: true}});
    return res.json({message: 'MFA enabled successfully'});
  } catch (error) {
    console.error('MFA enable error:', error);
    return res.status(500).json({error: 'Internal server error'});
  }
});

router.post('/mfa/verify', async (req, res) => {
  try {
    const {mfa_token: mfaToken, code} = req.body || {};
    if (typeof mfaToken !== 'string' || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({error: 'MFA token and 6-digit authenticator code are required'});
    }

    let challenge;
    try {
      challenge = verifyToken(mfaToken, 'mfa');
    } catch {
      return res.status(401).json({error: 'MFA challenge is invalid or expired'});
    }

    const user = await prisma.user.findUnique({where: {id: challenge.userId}});
    if (!user?.mfaEnabled || !user.mfaSecret) {
      return res.status(401).json({error: 'MFA is not enabled for this account'});
    }

    const result = await verifyTotp({secret: user.mfaSecret, token: code, epochTolerance: 30});
    if (!result.valid) return res.status(401).json({error: 'Invalid authenticator code'});

    return res.json(accessTokenResponse(user.id));
  } catch (error) {
    console.error('MFA verification error:', error);
    return res.status(500).json({error: 'Internal server error'});
  }
});

router.post('/mfa/disable', authenticateToken, async (req, res) => {
  try {
    const {password, code} = req.body || {};
    if (typeof password !== 'string' || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({error: 'Password and 6-digit authenticator code are required'});
    }

    const user = await prisma.user.findUnique({where: {id: req.user.userId}});
    if (!user?.mfaEnabled || !user.mfaSecret) {
      return res.status(400).json({error: 'MFA is not enabled'});
    }

    const [passwordMatches, totpResult] = await Promise.all([
      bcrypt.compare(password, user.password),
      verifyTotp({secret: user.mfaSecret, token: code, epochTolerance: 30})
    ]);
    if (!passwordMatches || !totpResult.valid) {
      return res.status(401).json({error: 'Password or authenticator code is incorrect'});
    }

    await prisma.user.update({
      where: {id: user.id},
      data: {mfaEnabled: false, mfaSecret: null}
    });
    return res.json({message: 'MFA disabled successfully'});
  } catch (error) {
    console.error('MFA disable error:', error);
    return res.status(500).json({error: 'Internal server error'});
  }
});

export default router;
