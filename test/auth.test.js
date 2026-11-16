import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import {generate as generateTotp} from 'otplib';

test('Scale 1 authentication works from signup through password reset and MFA', async (t) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-auth-test-'));
  const databasePath = path.join(temporaryDirectory, 'auth.db');
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE "User" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "email" TEXT NOT NULL,
      "password" TEXT NOT NULL,
      "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
      "mfaSecret" TEXT,
      "passwordResetTokenHash" TEXT,
      "passwordResetExpiresAt" DATETIME
    );
    CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
    CREATE INDEX "User_passwordResetTokenHash_idx" ON "User"("passwordResetTokenHash");
  `);
  database.close();

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = `file:${databasePath.replaceAll('\\', '/')}`;
  process.env.JWT_SECRET = 'test-only-secret-that-is-long-enough-for-auth-tests';
  process.env.JWT_ISSUER = 'notes-api-test';
  process.env.JWT_AUDIENCE = 'notes-api-test';
  process.env.AUTH_EXPOSE_TEST_TOKENS = 'true';

  const [{default: app}, {default: prisma}] = await Promise.all([
    import('../src/app.js'),
    import('../src/db.js')
  ]);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const {port} = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(method, route, {body, token} = {}) {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        ...(body ? {'content-type': 'application/json'} : {}),
        ...(token ? {authorization: `Bearer ${token}`} : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return {status: response.status, body: await response.json()};
  }

  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
    await fs.rm(temporaryDirectory, {recursive: true, force: true});
  });

  const email = 'mentor@example.com';
  const originalPassword = 'correct-password';
  const newPassword = 'new-correct-password';

  const signup = await request('POST', '/auth/signup', {
    body: {email: '  Mentor@Example.com ', password: originalPassword}
  });
  assert.equal(signup.status, 201);
  assert.equal(signup.body.email, email);

  const storedUser = await prisma.user.findUnique({where: {email}});
  assert.notEqual(storedUser.password, originalPassword);
  assert.match(storedUser.password, /^\$2[aby]\$/);

  const invalidLogin = await request('POST', '/auth/login', {
    body: {email, password: 'wrong-password'}
  });
  assert.equal(invalidLogin.status, 401);

  const login = await request('POST', '/auth/login', {
    body: {email, password: originalPassword}
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.mfa_required, false);
  assert.ok(login.body.access_token);

  const unauthenticatedProfile = await request('GET', '/auth/me');
  assert.equal(unauthenticatedProfile.status, 401);

  const profile = await request('GET', '/auth/me', {token: login.body.access_token});
  assert.equal(profile.status, 200);
  assert.equal(profile.body.email, email);
  assert.equal(profile.body.mfa_enabled, false);

  const forgotPassword = await request('POST', '/auth/forgot-password', {body: {email}});
  assert.equal(forgotPassword.status, 200);
  assert.ok(forgotPassword.body.reset_token);

  const resetPassword = await request('POST', '/auth/reset-password', {
    body: {token: forgotPassword.body.reset_token, password: newPassword}
  });
  assert.equal(resetPassword.status, 200);

  const reusedResetToken = await request('POST', '/auth/reset-password', {
    body: {token: forgotPassword.body.reset_token, password: 'another-password'}
  });
  assert.equal(reusedResetToken.status, 400);

  const oldPasswordLogin = await request('POST', '/auth/login', {
    body: {email, password: originalPassword}
  });
  assert.equal(oldPasswordLogin.status, 401);

  const newPasswordLogin = await request('POST', '/auth/login', {
    body: {email, password: newPassword}
  });
  assert.equal(newPasswordLogin.status, 200);

  const mfaSetup = await request('POST', '/auth/mfa/setup', {
    token: newPasswordLogin.body.access_token
  });
  assert.equal(mfaSetup.status, 200);
  assert.ok(mfaSetup.body.secret);
  assert.match(mfaSetup.body.otpauth_uri, /^otpauth:\/\/totp\//);

  const enrollmentCode = await generateTotp({secret: mfaSetup.body.secret});
  const enableMfa = await request('POST', '/auth/mfa/enable', {
    token: newPasswordLogin.body.access_token,
    body: {code: enrollmentCode}
  });
  assert.equal(enableMfa.status, 200);

  const mfaLogin = await request('POST', '/auth/login', {
    body: {email, password: newPassword}
  });
  assert.equal(mfaLogin.status, 200);
  assert.equal(mfaLogin.body.mfa_required, true);
  assert.ok(mfaLogin.body.mfa_token);
  assert.equal(mfaLogin.body.access_token, undefined);

  const challengeIsNotAccess = await request('GET', '/auth/me', {token: mfaLogin.body.mfa_token});
  assert.equal(challengeIsNotAccess.status, 401);

  const invalidMfa = await request('POST', '/auth/mfa/verify', {
    body: {mfa_token: mfaLogin.body.mfa_token, code: '000000'}
  });
  assert.equal(invalidMfa.status, 401);

  const loginCode = await generateTotp({secret: mfaSetup.body.secret});
  const verifyMfa = await request('POST', '/auth/mfa/verify', {
    body: {mfa_token: mfaLogin.body.mfa_token, code: loginCode}
  });
  assert.equal(verifyMfa.status, 200);
  assert.ok(verifyMfa.body.access_token);

  const mfaProfile = await request('GET', '/auth/me', {token: verifyMfa.body.access_token});
  assert.equal(mfaProfile.status, 200);
  assert.equal(mfaProfile.body.mfa_enabled, true);

  const disableCode = await generateTotp({secret: mfaSetup.body.secret});
  const disableMfa = await request('POST', '/auth/mfa/disable', {
    token: verifyMfa.body.access_token,
    body: {password: newPassword, code: disableCode}
  });
  assert.equal(disableMfa.status, 200);

  const loginAfterDisable = await request('POST', '/auth/login', {
    body: {email, password: newPassword}
  });
  assert.equal(loginAfterDisable.status, 200);
  assert.equal(loginAfterDisable.body.mfa_required, false);
  assert.ok(loginAfterDisable.body.access_token);
});
