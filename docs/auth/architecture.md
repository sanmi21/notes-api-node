# Authentication Architecture

## Document status

- Phase: 0.1 — Client and trust-boundary inventory
- Status: In progress
- Last updated: 2026-09-18
- Scope: Authentication consumers, trust boundaries, and permitted credential flows

This document is the first Phase 0 authentication design artifact. Later Phase 0 work will extend it with account states, token details, endpoint contracts, authorization rules, operational controls, and test requirements.

For the plain-language explanation of what we are building, why we are building it in stages, and how far we intend to scale it, read [Authentication Scale and Build Roadmap](./scale-roadmap.md).

## Goals

The authentication system must support:

1. A first-party mobile application.
2. Direct development and diagnostic use of the API.
3. Third-party applications acting with a user's consent.
4. Third-party services acting as themselves, if machine-to-machine access is enabled.
5. MFA during user authentication and for sensitive account actions.

The design must not require a third party to collect or store a Notes API user's password.

## Terms

- **Resource owner:** The user who owns notes and images.
- **First-party client:** A client developed and operated as part of the Notes product.
- **Third-party client:** A client operated outside the Notes product's control.
- **Public client:** A client that cannot safely keep a static secret, such as a mobile app or locally installed CLI.
- **Confidential client:** A server-side client capable of protecting its credentials.
- **Delegated access:** A client acts on behalf of a user and receives only the access that user approved.
- **Machine identity:** A service acts as itself rather than impersonating a user.

## System boundary

```text
User
  |
  +-- First-party mobile app --------+
  +-- Development client ------------+---- TLS ----> Notes API ----> Database
  +-- Third-party delegated app -----+                  |
                                                     Security logs
Third-party backend service ---------- TLS ---------->  |
                                                     Rate-limit store
Future email/MFA providers <---------- limited data ---+
```

The Notes API is the authoritative token issuer and authorization enforcement point for the initial system. Clients, network input, bearer tokens, forwarded headers, and client-supplied device information are untrusted.

The database, production secret store, and shared rate-limit store are trusted infrastructure. Access to them must remain private to the application and its operators.

## Consumer matrix

| Consumer | Trust classification | Acts as | Authentication flow | Long-lived credential | Initial availability |
|---|---|---|---|---|---|
| First-party mobile app | Public, first-party | User | Email/password, then MFA when required | Rotating refresh token in OS secure storage | Core authentication release |
| Postman/manual development client | Public, operator-controlled | User | Direct login in non-production or explicitly permitted environments | Prefer short-lived access; refresh only when needed | Core authentication release |
| First-party CLI, if created | Public, first-party | User | Interactive authorization with PKCE in the target design | Rotating refresh token in OS credential storage | Deferred |
| User-owned automation | Public or confidential depending on deployment | User | Scoped personal access token in the proposed design | Hashed, revocable personal access token | Decision pending |
| Third-party mobile or desktop app | Public, third-party | User | OAuth Authorization Code with PKCE and explicit consent | Rotating refresh token in secure storage | Third-party access phase |
| Third-party web backend | Confidential, third-party | User | OAuth Authorization Code with PKCE, redirect URI validation, and client authentication | Rotating refresh token in server-side secret storage | Third-party access phase |
| Server-to-server integration | Confidential, third-party | Machine identity | Client credentials or an equivalent service-account flow | Rotatable client credential | Decision pending |
| Internal administrative tool | Privileged, first-party | Staff or service identity | Separate administrative authentication with mandatory MFA | Dedicated privileged session or credential | Deferred; never shares ordinary user privileges |

## Approved credential-flow rules

### First-party mobile application

- Treat every installed app as a public client.
- Do not embed a shared client secret in the application package.
- The initial first-party flow may call the Notes API login and MFA endpoints directly.
- Access tokens are bearer JWTs with a short lifetime.
- Refresh tokens are opaque, rotated on every use, and stored using the operating system's protected credential storage.
- Normal application storage, analytics, crash reports, and logs must never contain raw tokens or passwords.
- When the OAuth authorization service is introduced, the mobile app should migrate to Authorization Code with PKCE through the system browser.

### Development and diagnostic clients

- Development convenience must not create a production bypass.
- Postman and similar clients may exercise the normal login/MFA flow.
- Seeded credentials, disabled verification, or MFA bypasses are permitted only in isolated test environments.
- Production access uses the same controls as any other client.
- Tokens must not be committed in request collections or source control.

### Third-party applications acting for users

- A third party must never request or receive the user's Notes API password.
- Delegated access uses Authorization Code with PKCE and explicit user consent.
- Every client has a registered identity and exact allowed redirect URIs.
- Tokens are restricted to the approved audience, user, client, and scopes.
- Public third-party clients do not receive or rely on a static client secret.
- Confidential clients authenticate at the token endpoint using an approved server-side mechanism.
- Refresh-token issuance is policy-controlled and uses rotation and reuse detection.
- Users can inspect and revoke third-party grants and sessions.

### Machine-to-machine consumers

- A machine identity is not represented as a human user.
- Machine credentials cannot use the email/password login flow.
- Every service identity has narrowly assigned scopes and an identifiable owner.
- Client credentials are stored as hashes where feasible and can be rotated and revoked.
- User-owned resources require an explicit authorization model; a service credential does not automatically gain access to every user's notes.

### User-owned automation

Personal access tokens may be useful for scripts that do not need a full OAuth client registration. If enabled, they will be treated as a separate credential type with:

- An explicit name and owner.
- Narrow scopes.
- Optional expiration.
- A visible prefix or identifier for lookup.
- Only a secure hash stored by the API.
- One-time display of the raw token.
- Last-used metadata and immediate revocation.

Personal access tokens are not refresh tokens and cannot be exchanged for broader credentials.

## Credential storage responsibilities

| Credential | Server storage | Client storage | Forbidden locations |
|---|---|---|---|
| User password | Argon2id/bcrypt hash only | Password manager or transient input | Logs, analytics, JWTs, plaintext database fields |
| Access JWT | Not normally persisted | Memory where practical | URLs, logs, analytics, source control |
| Refresh token | Secure hash plus session metadata | Mobile keychain/keystore or protected server secret store | Ordinary mobile preferences, browser local storage, logs |
| OAuth client secret | Secure hash or secret-manager-backed representation | Confidential backend only | Mobile apps, browser bundles, public repositories |
| Personal access token | Secure hash and metadata | User's secret manager | Logs, URLs, committed configuration |
| MFA TOTP secret | Encrypted at rest | Authenticator app | Logs, JWTs, analytics |
| MFA recovery code | Secure hash only | User-controlled secure storage | Logs, support tickets, plaintext database fields |

## Trust-boundary rules

1. All credentials and tokens cross the network only over TLS outside local development.
2. Possession of a bearer access token is sufficient to use its granted authority until it expires or is otherwise rejected.
3. Client-provided IP addresses, user-agent strings, device names, and forwarded headers are metadata, not proof of identity.
4. Forwarded headers are trusted only from explicitly configured reverse proxies.
5. Authentication proves an identity; route-level authorization and resource ownership are still checked independently.
6. Scope checks never replace note or image ownership checks.
7. MFA is completed at login, authorization, or step-up boundaries—not on every ordinary API request.
8. Email and MFA delivery providers receive only the minimum information needed to perform delivery.
9. Security logs use stable internal identifiers and must redact all secrets and raw tokens.
10. Disabling a user, client, grant, or session prevents future refresh and triggers the revocation behavior defined in Phase 0.2 and 0.3.

## Recorded decisions

| ID | Decision | Status |
|---|---|---|
| AUTH-001 | Retain short-lived JWT bearer access tokens for API access. | Accepted |
| AUTH-002 | Add opaque, stateful, rotating refresh tokens for eligible clients. | Accepted |
| AUTH-003 | Treat the first-party mobile app as a public client with no embedded secret. | Accepted |
| AUTH-004 | Third-party applications must not use or collect user passwords. | Accepted |
| AUTH-005 | Delegated third-party access will use Authorization Code with PKCE and consent. | Proposed |
| AUTH-006 | Machine identities, if supported, will be distinct from human user accounts. | Proposed |
| AUTH-007 | MFA will be part of the production authentication milestone and will support step-up checks. | Accepted |
| AUTH-008 | Personal access tokens, if supported, will be a separate scoped credential type. | Proposed |
| AUTH-009 | A future browser client will require its own storage and CSRF design; mobile token-storage assumptions will not be reused automatically. | Proposed |

## Open decisions

These decisions must be resolved before Phase 0.1 is marked complete:

1. **Third-party modes:** Confirm whether the product needs delegated user access, machine-to-machine access, or both.
2. **Personal automation:** Decide whether users need personal access tokens for scripts.
3. **Browser client:** Decide whether a first-party browser frontend is expected in the near term.
4. **Administrative access:** Decide whether an administrative API or dashboard is in scope.
5. **Production development access:** Decide whether manual clients such as Postman may use production credentials or are limited to non-production environments.

## Phase 0.1 completion checklist

- [x] First-party mobile client classified.
- [x] Development clients classified.
- [x] Delegated third-party clients classified.
- [x] Machine-to-machine clients classified.
- [x] Credential storage responsibilities documented.
- [x] Trust boundaries documented.
- [x] Prohibited credential flows documented.
- [ ] Product owner resolves the five open decisions.
- [ ] Proposed decisions are accepted, rejected, or amended.

Once this checklist is complete, Phase 0.2 can define the account, MFA, and session lifecycle without ambiguity about which actors participate in each flow.
