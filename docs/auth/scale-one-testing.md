# Scale 1 Authentication: What We Built and How to Test It

For a full explanation of the code, functions, services, database fields, and route workflows, read the [Scale 1 Implementation Guide](./scale-one-implementation.md).

## What “Scale 1” means in this project

Scale 1 is the first complete authentication layer. It teaches and demonstrates the basic account-security journey:

1. Create an account.
2. Log in with a password.
3. Receive an access token.
4. Use that token to open a protected endpoint.
5. Reset a forgotten password.
6. Add an authenticator app as a second login step.

This is now a functional learning and demonstration release. It is not yet the public-production release described in the larger roadmap. Rate limiting, refresh tokens, email verification, device sessions, encrypted MFA secrets, recovery codes, and production monitoring belong to later phases.

## The important idea behind each feature

### Passwords

The API never saves the original password. It runs the password through bcrypt and saves the resulting hash. During login, bcrypt checks whether the submitted password matches that hash.

This means the server can check the password without being able to read the original password from the database.

### Access tokens

After a successful login, the API returns an access token. Think of it as a temporary digital pass.

The client sends it with protected requests:

```text
Authorization: Bearer <access token>
```

The token lasts 30 minutes by default. It is signed so the server can detect if someone edits it.

### Password-reset tokens

When a password reset is requested, the API creates a long random value. The complete value is sent to the user, while only a SHA-256 hash is stored in the database.

The reset token:

- Expires after 15 minutes.
- Can be used only once.
- Is removed after a successful password change.
- Produces the same public response whether the email exists or not.

During local testing, `AUTH_EXPOSE_TEST_TOKENS=true` places the reset token in the response so you can complete the flow without an email account. This setting must never be enabled in production.

### MFA

MFA means multi-factor authentication. In this version, the two factors are:

1. Something the user knows: the password.
2. Something the user has: an authenticator app that can generate the current six-digit code.

MFA setup has two steps:

1. The API creates a secret and returns an `otpauth_uri` for an authenticator app.
2. The user submits a current code to prove setup worked.

MFA is not enabled until the second step succeeds.

After MFA is enabled, a correct password no longer returns an ordinary access token. It returns a five-minute MFA challenge token. The user exchanges that challenge plus a valid authenticator code for the real access token.

The MFA challenge token cannot be used to open protected routes.

## Endpoints now available

| Method | Endpoint | Purpose | Requires access token? |
|---|---|---|---|
| `POST` | `/auth/signup` | Create an account | No |
| `POST` | `/auth/login` | Check the password and begin login | No |
| `GET` | `/auth/me` | Demonstrate a protected endpoint | Yes |
| `POST` | `/auth/forgot-password` | Create a password-reset token | No |
| `POST` | `/auth/reset-password` | Use the token to replace the password | No |
| `POST` | `/auth/mfa/setup` | Create an authenticator secret | Yes |
| `POST` | `/auth/mfa/enable` | Confirm the first code and enable MFA | Yes |
| `POST` | `/auth/mfa/verify` | Finish a login that requires MFA | No; it uses the MFA challenge token in the body |
| `POST` | `/auth/mfa/disable` | Disable MFA using the password and a current code | Yes |

## Prepare the project

### 1. Check the environment file

For local testing, ensure `.env` has at least:

```env
DATABASE_URL="file:./dev.db"
PORT=5000
JWT_SECRET=replace-this-with-a-long-random-development-secret
AUTH_EXPOSE_TEST_TOKENS=true
```

Do not share the real `.env` file. Do not enable `AUTH_EXPOSE_TEST_TOKENS` on a public or production server.

### 2. Apply database migrations

```powershell
npx prisma migrate deploy
npx prisma generate
```

The first command adds the new database fields. The second updates Prisma Client so the application knows those fields exist.

### 3. Run the automated test

```powershell
npm run test:auth
```

This test uses a temporary database. It does not create mentor test accounts in the normal development database.

### 4. Start the API

```powershell
npm start
```

The local base address is:

```text
http://localhost:5000
```

## Test with Thunder Client

Create a Thunder Client collection named `Notes API - Scale 1`.

### Test 1 — Signup

```http
POST http://localhost:5000/auth/signup
Content-Type: application/json
```

```json
{
  "email": "mentor@example.com",
  "password": "correct-password"
}
```

Expected result: status `201` with the new user ID and normalized email. The password must not appear in the response.

### Test 2 — Login

```http
POST http://localhost:5000/auth/login
Content-Type: application/json
```

```json
{
  "email": "mentor@example.com",
  "password": "correct-password"
}
```

Expected result: status `200`, `mfa_required` is `false`, and an `access_token` is returned.

Copy the access token.

### Test 3 — Protected endpoint

```http
GET http://localhost:5000/auth/me
Authorization: Bearer <paste access token here>
```

Expected result: status `200` with the user's ID, email, and MFA status.

Repeat the request without the Authorization header. Expected result: status `401`.

### Test 4 — Request a password reset

```http
POST http://localhost:5000/auth/forgot-password
Content-Type: application/json
```

```json
{
  "email": "mentor@example.com"
}
```

With local token exposure enabled, the response contains `reset_token`. Copy it.

### Test 5 — Reset the password

```http
POST http://localhost:5000/auth/reset-password
Content-Type: application/json
```

```json
{
  "token": "<paste reset token here>",
  "password": "new-correct-password"
}
```

Expected result: status `200`.

Try the same reset token again. Expected result: status `400`, proving the token is single-use.

Try logging in with the old password. It should fail. Log in with the new password and copy the new access token.

### Test 6 — Begin MFA setup

```http
POST http://localhost:5000/auth/mfa/setup
Authorization: Bearer <new access token>
```

The response contains:

- `secret`: the manual setup key.
- `otpauth_uri`: the standard authenticator setup address.

In Google Authenticator, Microsoft Authenticator, 1Password, or another compatible app, choose the option to enter a setup key manually. Use:

- Account name: `mentor@example.com`
- Key: the returned `secret`
- Type: time-based

### Test 7 — Confirm MFA setup

Read the current six-digit code from the authenticator app.

```http
POST http://localhost:5000/auth/mfa/enable
Authorization: Bearer <new access token>
Content-Type: application/json
```

```json
{
  "code": "123456"
}
```

Replace `123456` with the real current code. Expected result: status `200` and `MFA enabled successfully`.

### Test 8 — Login with MFA

Log in again with the new password.

This time, the response contains:

- `mfa_required: true`
- `mfa_token`

It does not contain an access token yet. Copy the MFA token.

### Test 9 — Finish MFA login

```http
POST http://localhost:5000/auth/mfa/verify
Content-Type: application/json
```

```json
{
  "mfa_token": "<paste MFA token here>",
  "code": "123456"
}
```

Replace `123456` with the current authenticator code. Expected result: a normal access token.

Use that access token with `/auth/me`. The response should show `mfa_enabled: true`.

## Testing from another computer

`localhost` works only on your own computer. A mentor on another network cannot reach `http://localhost:5000`.

To let the mentor test remotely, the API must be deployed to a public HTTPS address. Before doing that:

- Set `AUTH_EXPOSE_TEST_TOKENS=false`.
- Configure real SMTP if password reset must be tested remotely.
- Use a strong production JWT secret.
- Do not share database files or `.env`.
- Run the full test suite.

The later roadmap still requires rate limiting and the other public-internet protections before treating the service as production-ready.
