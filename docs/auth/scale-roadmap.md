# Authentication Scale and Build Roadmap

## Why this document exists

Authentication can become complicated very quickly. This document explains, in plain language, how much authentication we are building, why each part exists, and the order in which we will build it.

The guiding rule is:

> The more damage a stolen account could cause, the stronger the authentication system must be.

We are using the attached Auth Scale Reference Guide as a starting point, but not copying it blindly. Some security controls are necessary as soon as an application is available on the public internet, even if the application is still small.

## What are we building?

We are building a **strong custom authentication system suitable for real users**, while also learning how the important parts work.

In the reference guide, this is closest to **Scale 3**:

- Real people may create accounts.
- Their notes may contain private information.
- A stolen account could expose or destroy their data.
- Users should be able to see and end their active login sessions.
- Users should be able to protect their account with MFA.
- Password changes and security events should invalidate old sessions.

However, our design also includes some **Scale 4-style preparation** because we want mobile apps and third-party API access:

- Permission-based access for outside applications.
- Separate identities for automated services.
- A clear point where we can move to a managed authentication provider later.

This does **not** mean we will build every enterprise feature immediately. We will build in safe, understandable stages.

## A simple explanation of the important pieces

| Feature | Plain-language meaning | Why we need it |
|---|---|---|
| Password hashing | The password is changed into a one-way protected value before storage. | A database leak should not reveal users' actual passwords. |
| Access token | A short-lived digital pass used when calling protected API routes. | The API needs to know who is making each request. |
| Refresh token | A longer-lived secret used only to obtain a new access token. | Mobile users should not need to enter their password every 15 minutes. |
| Token rotation | Every refresh token is replaced after it is used. | A stolen refresh token can be detected if it is reused. |
| Session | A database record representing one logged-in device or application. | Users need to view, revoke, and log out individual devices. |
| Rate limiting | Temporarily slowing or blocking excessive requests. | It makes password guessing and automated abuse harder. |
| Email verification | Proving the user controls the email address they registered. | Recovery messages and security alerts must go to the real owner. |
| Password recovery | A safe process for replacing a forgotten password. | Users need a way back into their account without weakening security. |
| MFA | Requiring another proof in addition to the password. | A stolen password alone should not always be enough to enter the account. |
| Scope | A named permission, such as `notes:read`. | Outside applications should receive only the access they actually need. |
| Revocation | Cancelling a session or credential before it naturally expires. | Users need a way to stop stolen or unwanted access. |
| Security log | A record of important authentication events without storing secrets. | Suspicious activity needs to be investigated and explained. |

## What we changed from the reference guide

The reference guide is useful, but the following refinements make the plan safer and more accurate.

### 1. Rate limiting is required before public launch

The reference suggests skipping rate limiting for a learning project. That is acceptable only while the API is local and private.

Once strangers on the internet can reach login or signup, those routes need protection from automated guessing and spam. We will therefore implement rate limiting before any public release.

### 2. HTTPS is a basic requirement, not an advanced feature

HTTPS protects passwords and tokens while they travel between the client and server. We may use plain HTTP during local development, but every public environment must use HTTPS from its first release.

### 3. Refresh tokens and session control belong together

A long-lived refresh token is powerful. If the server cannot revoke it, a stolen token may keep producing new access tokens until it expires.

Our refresh-token feature will therefore include:

- A session record in the database.
- Securely hashed refresh tokens.
- A new refresh token after every refresh.
- Detection when an old token is reused.
- Logout for one device.
- Logout for all devices.
- Automatic revocation after important security changes.

We will not build a weak "refresh endpoint only" version first.

### 4. We will avoid permanent account lockouts

A hard lockout can be abused: an attacker could intentionally enter the wrong password repeatedly and lock the real user out.

We will use temporary throttling and increasing delays. We can also require extra verification after suspicious activity. The goal is to slow attackers without making it easy to deny service to the account owner.

### 5. CSRF protection depends on how tokens are stored

CSRF is an attack where another website tricks a browser into sending an authenticated request.

- Mobile clients sending bearer tokens in an `Authorization` header are not using browser cookies, so traditional cookie-based CSRF protection does not apply to those requests.
- A future browser client using authentication cookies will need a clear CSRF design.

We will add the browser-specific protection when we design the browser client instead of applying it blindly to every client.

### 6. JWTs will contain only what the API needs

The reference example places both a user ID and email address inside the JWT. An email address is not necessary for authorizing note requests and can change over time.

Our access tokens will use a stable user ID plus carefully chosen security information, such as the session ID and permissions. We will avoid putting unnecessary personal information inside tokens.

### 7. MFA needs recovery and session rules

Generating and checking a six-digit authenticator code is only one part of MFA. A complete MFA feature also needs:

- A safe setup and confirmation process.
- Encrypted storage for the authenticator secret.
- One-time recovery codes stored as hashes.
- Rate limits on code attempts.
- Rules for replacing or disabling MFA.
- Session revocation after important MFA changes.
- A recovery process that does not let an attacker bypass MFA easily.

### 8. A managed provider is a business and risk decision

A growing team does not automatically make custom authentication wrong, and a small team does not automatically make it safe.

We should consider moving to a managed provider when any of these become true:

- Authentication work is slowing down the main product.
- We need social login, enterprise SSO, SAML, or many identity providers.
- Compliance requirements need independently certified controls.
- The team cannot confidently maintain and monitor the custom system.
- The financial or legal cost of an authentication mistake becomes too high.

The provider decision will be reviewed before a large public launch and again before enterprise features.

### 9. Third-party access is its own security project

Allowing another application to access a user's notes is more than ordinary login. It requires client registration, user consent, limited permissions, redirect protection, token rules, and a way for the user to revoke access.

We will not give third-party applications the user's password. Third-party access will be built after the first-party account system is stable.

## The build plan

The numbered phases below are implementation stages. They are different from the reference guide's risk scales. A risk scale tells us **how much protection we need**; an implementation phase tells us **what we build next**.

## Phase 0 — Make the decisions before writing more auth code

### Goal

Agree on the system we are building so we do not repeatedly rewrite authentication later.

### Work

1. List every type of user, app, and service that will connect.
2. Define account, login, MFA, and session states.
3. Define access-token and refresh-token rules.
4. Define every authentication endpoint.
5. Decide which permissions each client can receive.
6. Set password, email, rate-limit, and recovery rules.
7. Define production secret and logging requirements.
8. Turn every decision into a testable requirement.

### Result

We have a readable plan, agreed rules, and a checklist for later implementation.

### Current progress

Phase 0.1 is in progress. The client types and trust boundaries are recorded in [Authentication Architecture](./architecture.md).

## Phase 1 — Prepare the application for safe authentication work

### Goal

Make the application easy to configure, test, and diagnose before changing its security behavior.

### Work

- Separate creation of the Express application from starting the server.
- Put authentication settings in one validated configuration module.
- Reject missing or unsafe production settings at startup.
- Add one consistent error-response format.
- Add request IDs so errors can be traced without exposing secrets.
- Create a separate test database and reliable test setup.
- Add limits to request-body size.

### Why this comes first

Authentication mistakes are difficult to catch when the application cannot be tested cleanly. This phase gives us the foundation for proving that later security work behaves correctly.

## Phase 2 — Strengthen signup, passwords, login, and access tokens

### Goal

Make the existing core authentication safe and predictable.

### Work

- Validate every signup and login field.
- Apply one clear email-normalization rule.
- Use a strong password policy that supports passphrases and password managers.
- Use Argon2id for new password hashes, or safely migrate existing bcrypt hashes.
- Return safe login and signup messages that do not reveal unnecessary account information.
- Reduce timing differences between unknown-user and wrong-password failures.
- Create short-lived access JWTs with a fixed issuer, audience, algorithm, and purpose.
- Strictly require `Authorization: Bearer <token>`.
- Return `401` for invalid authentication and `403` for insufficient permission.
- Test successful and failed authentication paths.

### Result

Users can create accounts and log in using a hardened version of the current flow. Access tokens are short-lived and checked strictly.

## Phase 3 — Make the core safe for the public internet

### Goal

Protect the public endpoints from automated abuse and establish reliable account ownership.

### Work

- Require HTTPS in public environments.
- Rate-limit signup, login, verification, and recovery routes.
- Track attempts per account and per network source where appropriate.
- Add email verification.
- Add safe password reset with short-lived, one-time tokens.
- Add security-event logging without passwords or raw tokens.
- Add alerts or visible signals for suspicious authentication behavior.
- Define trusted proxy behavior so client addresses cannot be easily forged.

### Result

The API is ready for a controlled public beta using short-lived access tokens. Users may still need to log in again when an access token expires until Phase 4 is finished.

## Phase 4 — Add refresh tokens and device sessions

### Goal

Keep mobile users signed in without turning a stolen refresh token into permanent access.

### Work

- Create a database record for each login session.
- Generate a random opaque refresh token.
- Store only a secure hash of that token.
- Rotate the refresh token every time it is used.
- Make concurrent refresh requests safe so only one can win.
- Detect reuse of an older refresh token and revoke the affected session.
- Let users list their active sessions.
- Add logout for the current session.
- Add logout for a selected device.
- Add logout everywhere.
- Revoke sessions after password reset and other serious security events.

### Result

The mobile app can remain signed in, while the user and server still have control over every login session.

## Phase 5 — Complete the account lifecycle

### Goal

Handle important account changes without creating recovery shortcuts for attackers.

### Work

- Change password using the current password or recent authentication.
- Change email using verification and security notifications.
- Disable or delete an account safely.
- Define temporary account throttling and recovery behavior.
- Notify users about important account-security changes.
- Ensure session revocation rules are applied consistently.

### Result

Users can safely manage the full life of their account, not just signup and login.

## Phase 6 — Add MFA

### Goal

Make a stolen password insufficient to access an MFA-protected account.

### First MFA method

We will begin with authenticator-app codes, commonly called TOTP. The user scans a QR code into an authenticator app, which then generates a new six-digit code every short period.

### Work

- Begin MFA setup without enabling it immediately.
- Show a QR code and verify one valid code before enabling MFA.
- Encrypt the authenticator secret in the database.
- Generate one-time recovery codes and store only their hashes.
- Split login into password verification followed by an MFA challenge.
- Do not issue normal access or refresh tokens before the MFA step succeeds.
- Rate-limit incorrect MFA attempts.
- Require recent authentication to replace or disable MFA.
- Revoke other sessions after important MFA changes.
- Record the successful authentication methods in the session and access token.
- Require a recent MFA check for especially sensitive actions when appropriate.

### Later improvement

Add passkeys/WebAuthn as a stronger, phishing-resistant option after TOTP is stable.

### Result

Users can protect their accounts with a second factor and recover using controlled, one-time codes.

## Phase 7 — Add outside applications and automation

### Goal

Allow external software to use the API without sharing user passwords or receiving unlimited access.

### Delegated user access

For an application acting for a user:

- Register the application.
- Show the user exactly what it is requesting.
- Use Authorization Code with PKCE.
- Issue only the approved permissions.
- Allow the user to review and revoke access.

### Personal automation

If approved during Phase 0:

- Allow users to create named personal access tokens.
- Show the complete token only once.
- Store only its hash.
- Allow limited permissions and expiration.
- Show when it was last used.
- Allow immediate revocation.

### Machine-to-machine access

If approved during Phase 0:

- Give services their own identities.
- Do not represent a service as a human user.
- Issue limited permissions.
- Support credential rotation and revocation.
- Define exactly which resources the service may access.

### Result

Third-party software can use the API through controlled, visible, and revocable access.

## Phase 8 — Production operations and scale review

### Goal

Make the system maintainable when usage, risk, or the development team grows.

### Work

- Store production secrets in a proper secret manager.
- Document signing-key rotation and emergency revocation.
- Use a shared rate-limit store when multiple API instances are running.
- Revisit SQLite before multi-instance or high-concurrency production deployment.
- Define security-log retention and access rules.
- Monitor failed logins, refresh-token reuse, MFA failures, and unusual access patterns.
- Run dependency, security, and architecture reviews.
- Practice account and credential incident response.
- Make a formal build-versus-managed-provider decision.

### Result

The authentication system is not only feature-complete; it can also be operated, monitored, repaired, and eventually migrated.

## Release gates

We will not call a feature finished simply because its happy path works.

| Release stage | Minimum authentication requirement |
|---|---|
| Local learning and development | Existing login may run locally with test data and no real users. |
| Private test environment | Phases 1 and 2 complete, HTTPS enabled, isolated test accounts only. |
| Controlled public beta | Phases 1–3 complete, including rate limiting, email verification, recovery, logging, and tests. |
| Mobile production release | Phases 1–6 complete, including session control, refresh rotation, account lifecycle, and MFA. |
| Third-party developer release | Phases 1–7 complete plus a focused review of permissions, consent, redirects, and revocation. |
| Larger production scale | Phase 8 operational controls complete and the managed-provider decision reviewed. |

## How we will work through each phase

For every phase, we will follow the same process:

1. **Explain it:** Describe the problem and proposed solution in plain language.
2. **Decide it:** Record the exact behavior before coding.
3. **Design it:** Define database changes, API requests, responses, and failure cases.
4. **Build it:** Implement the smallest complete version of the feature.
5. **Test it:** Test success, failure, misuse, and concurrent requests where relevant.
6. **Document it:** Explain what was built, how clients use it, and how operators maintain it.
7. **Review it:** Check whether the feature meets its agreed completion rules before moving on.

## What we are not doing

- We are not adding security features merely to make the project look complicated.
- We are not giving third parties user passwords.
- We are not treating refresh tokens as untracked long-lived JWTs.
- We are not relying on a mobile app to protect an embedded secret.
- We are not using MFA without recovery and revocation rules.
- We are not building browser-cookie behavior before a browser client is in scope.
- We are not assuming custom authentication must remain custom forever.

## Immediate next step

Finish Phase 0.1 by deciding which outside-client types the product will support:

1. Third-party applications acting for users.
2. Automated services acting as themselves.
3. Personal access tokens for user scripts.
4. A future browser client.
5. A future administrative interface.

After those choices are recorded, Phase 0.2 will define the account, login, MFA, and session states from signup through account deletion.
