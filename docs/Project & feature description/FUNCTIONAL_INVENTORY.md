# Notes API — General Feature Design and Functional Inventory

> Snapshot date: 20 September 2026  
> Scope: current local working tree, including work that has not yet been committed  
> Purpose: explain what the application currently does, how its major parts work together, what has been tested, and what is still unfinished

This is the master project document. Feature-specific documents provide deeper explanations:

- [Upload Implementation FDD](./FDD/UPLOAD_IMPLEMENTATION_FDD.md)
- [Authentication Architecture](../auth/architecture.md)
- [Authentication Scale and Build Roadmap](../auth/scale-roadmap.md)
- [Scale 1 Authentication Implementation Guide](../auth/scale-one-implementation.md)
- [Scale 1 Authentication Testing Guide](../auth/scale-one-testing.md)

## 1. Project overview

The Notes API is a REST API for private user notes.

A user can:

- Create an account.
- Log in with an email and password.
- Reset a forgotten password.
- Enable or disable authenticator-app MFA.
- Create, read, update, and delete personal notes.
- Attach approved images or PDF files to notes.
- Retrieve uploads through protected routes.
- Delete individual uploads.

The API is built with Node.js, Express 5, Prisma ORM 5, and SQLite. Files can be stored locally, in Amazon S3 or an S3-compatible service, or in Cloudinary.

## 2. Current feature summary

| Area | Current capability |
|---|---|
| Server | Express JSON API with a separate application module and server entry point |
| Signup | Normalized email, basic email validation, password-length checks, bcrypt hashing |
| Login | Password login with short-lived JWT access tokens |
| Password recovery | Random 15-minute, single-use reset tokens stored as hashes |
| MFA | Authenticator-app TOTP setup, confirmation, login challenge, and disabling |
| Token verification | Fixed algorithm, issuer, audience, expiration, subject, and token-purpose checks |
| Authorization | All note routes require an access token and enforce ownership |
| Notes | Create, list, retrieve one, partially update, and delete |
| Tags | Arrays at the API boundary; JSON text in SQLite |
| Upload validation | Business upload types, MIME allowlists, size limits, and file-signature checks |
| Storage | Local, S3/S3-compatible, or Cloudinary through one storage service interface |
| Retrieval | Local files stream; remote files redirect to protected provider URLs |
| Automated tests | One full authentication journey plus 12 storage tests |
| Dependency security | Latest check reported zero known vulnerabilities |

## 3. Current release level

The authentication system is currently a **Scale 1 functional and learning release**.

That means the complete basic workflows work and are tested, but the application is not yet considered production-hardened. Later phases will add rate limiting, refresh tokens, device sessions, email verification, encrypted MFA secrets, recovery codes, security monitoring, and third-party OAuth.

## 4. Route index

The application currently exposes 19 endpoints:

- 1 public welcome endpoint.
- 9 authentication/account endpoints.
- 9 protected note/upload endpoints.

### Public and authentication routes

| Method | Path | Access requirement | Purpose |
|---|---|---|---|
| `GET` | `/` | Public | Confirm that the HTTP server responds |
| `POST` | `/auth/signup` | Public | Create an account |
| `POST` | `/auth/login` | Public | Check the password and either complete login or begin MFA |
| `POST` | `/auth/forgot-password` | Public | Start password recovery |
| `POST` | `/auth/reset-password` | Reset token in body | Replace a password using an unexpired reset token |
| `GET` | `/auth/me` | Access token | Return the current user's basic account information |
| `POST` | `/auth/mfa/setup` | Access token | Create an authenticator secret and setup URI |
| `POST` | `/auth/mfa/enable` | Access token | Confirm a code and enable MFA |
| `POST` | `/auth/mfa/verify` | MFA challenge in body | Finish an MFA-protected login and receive an access token |
| `POST` | `/auth/mfa/disable` | Access token, password, and TOTP code | Disable MFA |

### Protected note and upload routes

Every route below first passes through access-token authentication.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/notes` | Create a note |
| `GET` | `/notes` | List the current user's notes |
| `GET` | `/notes/:id` | Get one owned note and its uploads |
| `PUT` | `/notes/:id` | Partially update an owned note |
| `DELETE` | `/notes/:id` | Delete an owned note and its stored files |
| `POST` | `/notes/:id/images` | Attach one approved file to an owned note |
| `GET` | `/notes/:id/images` | List a note's upload records |
| `GET` | `/notes/:noteId/images/:imageId/file` | Stream or redirect to an owned upload |
| `DELETE` | `/notes/:noteId/images/:imageId` | Delete one owned upload |

## 5. Repository structure

```text
notes_api/
├── src/
│   ├── app.js                       Builds and exports the Express app
│   ├── server.js                    Starts the HTTP listener
│   ├── db.js                        Shared Prisma Client
│   ├── middleware.js                Access-token and note-ownership checks
│   ├── utility.js                   Upload response serialization
│   ├── upload.js                    Multer memory-upload configuration
│   ├── auth/
│   │   ├── tokens.js                JWT creation and verification
│   │   └── password-reset.js        Reset-token generation and hashing
│   ├── services/
│   │   └── email.service.js         SMTP/development reset delivery
│   ├── routes/
│   │   ├── auth.js                  Authentication and account routes
│   │   └── notes.js                 Notes and upload routes
│   └── storage/
│       ├── storage.config.js
│       ├── storage.selector.js
│       ├── storage.factory.js
│       ├── storage.service.js
│       ├── upload-access.js
│       └── providers/
│           ├── local.storage.js
│           ├── s3.storage.js
│           └── cloudinary.storage.js
├── test/
│   ├── auth.test.js
│   └── storage.test.js
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│       ├── 20260812094731_init/
│       ├── 20260820192227_add_note_timestamps_and_images/
│       ├── 20260913000000_add_storage_provider/
│       └── 20260920000000_add_scale_one_auth/
├── docs/
│   ├── auth/
│   │   ├── architecture.md
│   │   ├── scale-roadmap.md
│   │   ├── scale-one-implementation.md
│   │   └── scale-one-testing.md
│   └── Project & feature description/
│       ├── FUNCTIONAL_INVENTORY.md
│       └── FDD/
│           └── UPLOAD_IMPLEMENTATION_FDD.md
├── uploads/
├── .env
├── .env.example
├── package.json
├── package-lock.json
├── prisma.config.ts
├── README.md
└── requests.http
```

Generated dependency files, Git internals, and local assistant/editor configuration are not application features and are omitted from this tree.

## 6. Application startup

The application and server are intentionally separated.

```text
server.js
├── loads .env
├── imports app.js
└── listens on PORT or 5000

app.js
├── creates Express app
├── accepts JSON bodies up to 100kb
├── mounts /auth routes
├── mounts /notes routes
├── registers GET /
├── registers global error handling
└── exports the app without opening a port
```

This separation allows automated tests to start the real Express application on a temporary port and close it after testing.

### Commands

| Command | Action |
|---|---|
| `npm start` | Starts `node src/server.js` |
| `npm run dev` | Starts `nodemon src/server.js` |
| `npm test` | Runs all Node tests |
| `npm run test:auth` | Runs only the complete authentication journey test |
| `npx prisma migrate deploy` | Applies pending database migrations |
| `npx prisma generate` | Regenerates Prisma Client from the schema |

There is no build step because the project runs JavaScript ES modules directly.

## 7. Environment configuration

### Core server and database

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | Prisma SQLite connection URL |
| `PORT` | No | HTTP port; defaults to `5000` |

### Authentication

| Variable | Required | Purpose |
|---|---:|---|
| `JWT_SECRET` | Yes | Signs and verifies JWTs |
| `JWT_ISSUER` | No | Expected JWT issuer; defaults to `notes-api` |
| `JWT_AUDIENCE` | No | Expected JWT audience; defaults to `notes-api` |
| `JWT_ACCESS_EXPIRES_IN` | No | Access-token lifetime; defaults to `30m` |
| `MFA_CHALLENGE_EXPIRES_IN` | No | MFA challenge lifetime; defaults to `5m` |
| `AUTH_EXPOSE_TEST_TOKENS` | No | Returns reset tokens for local manual testing only |

### Password-reset delivery

| Variable | Required | Purpose |
|---|---:|---|
| `PASSWORD_RESET_URL` | No | Frontend reset-page URL placed in the email |
| `SMTP_HOST` | Production reset delivery | SMTP server |
| `SMTP_PORT` | No | SMTP port; defaults to `587` |
| `SMTP_USER` | Depends on provider | SMTP username |
| `SMTP_PASS` | Depends on provider | SMTP password |
| `EMAIL_FROM` | No | Sender shown in reset email |

Without SMTP, development prints the reset link in the terminal. Production deliberately fails reset delivery when SMTP is missing instead of claiming that an email was sent.

### Storage

| Variable | Default | Purpose |
|---|---|---|
| `STORAGE_PROVIDER` | `local` | Provider used when `uploadType` is omitted |
| `LOCAL_UPLOAD_DIR` | `uploads` | Local storage root |
| `LOCAL_UPLOAD_URL` | `/uploads` | Legacy/provider URL prefix |
| `S3_BUCKET` | None | S3 bucket |
| `S3_REGION` | None | S3 region |
| `S3_ACCESS_KEY` | None | Optional explicit access key |
| `S3_SECRET_KEY` | None | Optional explicit secret key |
| `S3_ENDPOINT` | None | Optional compatible-service endpoint |
| `S3_FORCE_PATH_STYLE` | `false` | Enables path-style requests |
| `S3_SIGNED_URL_EXPIRES_IN` | `300` | Signed-download lifetime in seconds |
| `CLOUDINARY_CLOUD_NAME` | None | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | None | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | None | Cloudinary API secret |
| `CLOUDINARY_FOLDER` | `notelify` | Default Cloudinary folder |

`.env` is ignored by Git. `.env.example` contains safe placeholders and documentation. Secret values are intentionally not reproduced here.

## 8. Authentication implementation

Detailed code-level documentation is available in the [Scale 1 Authentication Implementation Guide](../auth/scale-one-implementation.md).

### Signup

`POST /auth/signup`:

1. Trims the email and converts it to lowercase.
2. Performs a basic email-shape and maximum-length check.
3. Requires a password between 8 and 128 characters.
4. Rejects an existing email with `409`.
5. Hashes the password with bcrypt cost 10.
6. Saves the user.
7. Returns only `{id, email}` with `201`.

A database uniqueness race is also handled as `409` instead of becoming an unexplained server error.

### Login without MFA

`POST /auth/login` normalizes the email, finds the user, and compares the password with the bcrypt hash.

Without MFA, success returns:

```json
{
  "access_token": "<signed JWT>",
  "token_type": "Bearer",
  "expires_in": 1800,
  "mfa_required": false
}
```

Unknown email and incorrect password both return `401 Invalid credentials`.

### Login with MFA

When `mfaEnabled` is true, a correct password returns an MFA challenge instead of an access token:

```json
{
  "mfa_required": true,
  "mfa_token": "<five-minute JWT>",
  "expires_in": 300
}
```

The client submits the challenge and current six-digit code to `POST /auth/mfa/verify`. Only then is an access token issued.

### Access-token contents and checks

Access tokens contain:

- `sub`: user ID.
- `token_use: access`.
- `iss`: configured issuer.
- `aud`: configured audience.
- `iat`: issue time.
- `exp`: expiration time.

Verification explicitly checks the `HS256` algorithm, signature, issuer, audience, expiration, token purpose, and positive numeric user ID.

### Authorization header

Protected routes require exactly:

```text
Authorization: Bearer <access token>
```

Missing, malformed, expired, or wrong-purpose tokens return `401`. An MFA challenge cannot be substituted for an access token.

### Password recovery

`POST /auth/forgot-password` creates 32 random bytes and returns a general message whether the email exists or not.

For a real account:

1. The original token is prepared for delivery.
2. Only its SHA-256 hash is saved.
3. The token expires after 15 minutes.
4. A new request replaces the previous token.

`POST /auth/reset-password` hashes the submitted token, requires an unexpired database match, saves a bcrypt hash of the new password, and clears the reset-token fields. The same token cannot succeed again.

In local development, `AUTH_EXPOSE_TEST_TOKENS=true` adds `reset_token` to the response for Thunder Client testing. The code refuses to expose it when `NODE_ENV=production`.

### MFA enrollment

`POST /auth/mfa/setup` requires an access token and returns:

- A random Base32 secret.
- A standard `otpauth://` URI.

The secret is saved, but MFA remains disabled until `POST /auth/mfa/enable` receives a valid current code. A 30-second tolerance is allowed for small clock differences.

### MFA disabling

`POST /auth/mfa/disable` requires:

- A valid access token.
- The current password.
- A valid current authenticator code.

Success sets `mfaEnabled` to false and deletes the saved MFA secret.

## 9. Ownership and authorization

Authentication and ownership are separate controls:

- Authentication answers: “Who is making this request?”
- Ownership answers: “Does this user own this note or upload?”

Every `/notes` request runs through `authenticateToken`.

`verifyNoteOwnership`:

1. Converts the route ID to a number.
2. Requires a positive integer.
3. Searches by both note ID and authenticated user ID.
4. Returns `404` for a missing or foreign note.
5. Places the owned note on `req.note` for the handler.

`findOwnedUpload` requires the image ID, note ID, and the note owner's user ID to match. This protects individual download and deletion routes from cross-user access.

## 10. Note behavior

### Create note

`POST /notes` requires a truthy `title`. Optional `content` is stored directly. An array of tags is serialized as JSON; missing or non-array tags become `[]`.

The authenticated user ID becomes the note owner. Success returns `201` with tags converted back into an array.

### List notes

`GET /notes` returns only the caller's notes, newest first. Upload metadata is omitted from the list response.

There is currently no pagination, filtering, or search.

### Retrieve one note

`GET /notes/:id` verifies ownership, loads all upload rows for that note, parses tags, and returns the note with serialized `images`.

### Update note

`PUT /notes/:id` behaves as a partial update:

- Supplied `title` replaces the title.
- Supplied `content` replaces the content.
- Supplied array `tags` replaces the stored JSON array.
- Missing fields stay unchanged.

Because the route behaves partially, `PATCH` would describe its behavior more accurately than `PUT`.

### Delete note

`DELETE /notes/:id`:

1. Verifies ownership.
2. Loads all related uploads.
3. Deletes provider files concurrently.
4. Deletes the note.
5. Relies on SQLite cascade deletion for upload rows.
6. Returns `204`.

Provider storage and SQLite cannot share one transaction, so partial cleanup remains possible if one system fails after the other succeeds.

## 11. Upload behavior

### Upload request

`POST /notes/:id/images` expects `multipart/form-data`:

- Required file field: `image`.
- Optional text field: `uploadType`.
- Absolute Multer limit: 10 MiB.

| Upload type | Allowed files | Business limit | Selected provider |
|---|---|---:|---|
| `note-image` | JPEG, PNG, WebP, GIF | 5 MiB | Cloudinary |
| `avatar` | JPEG, PNG, WebP, GIF | 5 MiB | Cloudinary |
| `attachment` | Listed images or PDF | 10 MiB | S3 |
| `document` | Listed images or PDF | 10 MiB | S3 |
| Omitted | Treated as `note-image` | 5 MiB | Configured default provider |

The route checks:

1. Access token.
2. Note ownership.
3. File presence.
4. Allowed business type.
5. Allowed MIME type.
6. Type-specific size limit.
7. Leading file bytes matching the claimed MIME type.

Recognized signatures are JPEG, PNG, GIF87a/GIF89a, RIFF+WEBP, and `%PDF-`.

These are useful checks but are not full parsing, sanitization, or malware scanning.

### Upload response

The database stores provider details, but API responses replace the provider URL with a protected route:

```text
/notes/<noteId>/images/<imageId>/file
```

### List uploads

`GET /notes/:id/images` verifies note ownership and returns serialized upload metadata. Despite the `/images` name, the list may contain PDFs.

### Retrieve upload

`GET /notes/:noteId/images/:imageId/file` verifies ownership and then:

- Streams a local file with `sendFile`.
- Redirects to a short-lived S3 presigned URL.
- Redirects to a signed authenticated Cloudinary URL.

### Delete one upload

`DELETE /notes/:noteId/images/:imageId` verifies ownership, deletes the provider object, deletes the database row, and returns `204`.

If the provider succeeds but the database fails, a stale database row may remain.

## 12. Storage subsystem

The route code does not need separate upload logic for every provider. It calls one service layer.

```text
Route
  ↓
storage.service.js
  ↓
storage.selector.js chooses provider when needed
  ↓
storage.factory.js creates/caches provider
  ↓
LocalStorage | S3Storage | CloudinaryStorage
```

### Provider selection

```text
avatar or note-image       → Cloudinary
attachment or document     → S3
other image/video MIME     → Cloudinary
file larger than 5 MiB     → S3
otherwise                  → configured default
```

The current upload route uses the configured default when `uploadType` is omitted for local/backward compatibility.

### Local provider

- Requires an in-memory Buffer.
- Uses UUID filenames and MIME-derived extensions.
- Sanitizes folder segments.
- Rejects absolute paths and `..` traversal.
- Creates directories as needed.
- Writes with exclusive-create behavior.
- Streams files only through the protected API route.

### S3 provider

- Requires bucket and region.
- Supports AWS S3 and compatible endpoints.
- Can use explicit credentials or the AWS credential chain.
- Uses UUID object keys.
- Supports deletion and presigned downloads.
- Creates the S3 client only when it is first needed.

### Cloudinary provider

- Requires cloud name, API key, and API secret.
- Uploads assets as authenticated rather than public resources.
- Uses folder-prefixed UUID public IDs.
- Returns width, height, and format metadata when available.
- Generates signed authenticated delivery URLs.

### Recorded-provider dispatch

Each database row records its provider. Download and deletion use the recorded provider, not today's default. This allows local, S3, and Cloudinary files to coexist.

## 13. Error handling

The final Express error middleware converts:

- Multer size errors into `400 File exceeds the 10 MB limit`.
- Other Multer failures into `400 Invalid upload`.
- Errors with an explicit `statusCode` into that status and message.
- Other forwarded failures into logged `500 Internal server error`.

Most route handlers catch their own expected failures. Express 5 forwards unexpected asynchronous errors to the global handler.

Authentication uses these main status meanings:

| Status | Meaning |
|---:|---|
| `400` | Request data is missing, malformed, expired, or invalid |
| `401` | Authentication or MFA proof is missing or incorrect |
| `404` | Owned resource was not found |
| `409` | Account or MFA state conflicts with the request |
| `500` | Unexpected application, database, email, or provider failure |

## 14. Database model

```text
User 1 ──────< Note 1 ──────< NoteImage
```

### User

| Field | Meaning |
|---|---|
| `id` | Auto-increment primary key |
| `email` | Required unique login email |
| `password` | Required bcrypt hash |
| `mfaEnabled` | Whether MFA is required during login |
| `mfaSecret` | Base32 secret used to verify TOTP codes |
| `passwordResetTokenHash` | SHA-256 hash of the active reset token |
| `passwordResetExpiresAt` | Reset-token expiration time |
| `notes` | User's related notes |

`passwordResetTokenHash` has a database index for lookup.

### Note

| Field | Meaning |
|---|---|
| `id` | Auto-increment primary key |
| `title` | Required title |
| `content` | Optional text |
| `tags` | Required JSON-text array |
| `userId` | Owner ID |
| `user` | User relation with cascade deletion |
| `images` | Related upload rows |
| `createdAt` | Creation time |
| `updatedAt` | Last Prisma update time |

### NoteImage

| Field | Meaning |
|---|---|
| `id` | Auto-increment primary key |
| `url` | Legacy/provider URL field |
| `provider` | `local`, `s3`, or `cloudinary` |
| `key` | Provider storage key |
| `originalName` | Original client filename |
| `fileSize` | Size in bytes |
| `mimeType` | Validated MIME type |
| `resourceType` | Provider category such as `image` or `raw` |
| `metadata` | Provider metadata stored as JSON text |
| `uploadType` | Business category |
| `noteId` | Parent note ID |
| `note` | Note relation with cascade deletion |
| `createdAt` | Creation time |

Database cascades delete rows but cannot delete remote provider files by themselves. Provider cleanup must happen through application routes.

## 15. Migration history

| Migration | Change |
|---|---|
| `20260812094731_init` | Creates `User`, `Note`, ownership relation, and unique email index |
| `20260820192227_add_note_timestamps_and_images` | Adds note timestamps and `NoteImage` |
| `20260913000000_add_storage_provider` | Adds provider-neutral upload metadata |
| `20260920000000_add_scale_one_auth` | Adds MFA and password-reset fields plus reset-token index |

All four migrations are applied to the current local SQLite database.

## 16. Dependencies

| Package | Current version | Purpose |
|---|---:|---|
| `@aws-sdk/client-s3` | `3.1131.0` | S3 upload and deletion commands |
| `@aws-sdk/s3-request-presigner` | `3.1131.0` | Signed S3 download URLs |
| `@prisma/client` | `5.22.0` | Database ORM client |
| `bcryptjs` | `3.0.3` | Password hashing and comparison |
| `better-sqlite3` | `13.0.3` | Temporary SQLite database setup in tests |
| `cloudinary` | `2.11.0` | Cloudinary upload, deletion, and signed URLs |
| `dotenv` | `17.4.2` | Environment loading |
| `express` | `5.2.1` | HTTP API framework |
| `jsonwebtoken` | `9.0.3` | JWT signing and verification |
| `multer` | `2.4.0` | Multipart upload parsing in memory |
| `nodemailer` | `10.0.10` | Password-reset email delivery |
| `otplib` | `13.5.0` | TOTP secret, URI, code generation, and verification |
| `nodemon` | `3.1.14` | Development server restarts |
| `prisma` | `5.22.0` | Prisma CLI and client generation |

The Multer and transitive request-parser packages were updated after a dependency audit. The latest audit reported zero known vulnerabilities.

## 17. Automated tests

### Authentication integration test

`test/auth.test.js` starts the real Express app with a temporary SQLite database and sends HTTP requests through the complete flow.

It verifies:

- Email normalization.
- Password hashing.
- Incorrect-password rejection.
- Access-token login.
- Protected-route rejection without a token.
- Protected access with a token.
- Password-reset creation and completion.
- Reset-token single use.
- Old-password rejection after reset.
- MFA setup and confirmation.
- MFA challenge behavior during login.
- Rejection of a challenge token on an access-token route.
- Rejection of an incorrect MFA code.
- Access-token issuance after a correct MFA code.
- MFA disabling.

The temporary database is deleted after the test.

### Storage tests

`test/storage.test.js` contains 12 tests covering:

- Default and explicit provider selection.
- Unsupported providers and upload types.
- Local upload/retrieval/deletion and path safety.
- Legacy storage-key resolution.
- Dispatch using the provider recorded on each row.
- Mocked S3 behavior.
- Mocked Cloudinary behavior.
- User-scoped upload lookup.

### Latest verification result

```text
13 tests
13 passed
0 failed
```

JavaScript syntax checks passed, Prisma validates the schema, all four migrations are applied, the live welcome route returned `200`, and the protected profile route correctly returned `401` without an access token.

## 18. Documentation and manual testing

- `README.md` links to the authentication explanation and testing guide.
- `requests.http` contains signup, login, profile, password-reset, and MFA examples.
- `docs/auth/scale-one-implementation.md` explains the new code in detail.
- `docs/auth/scale-one-testing.md` provides a Thunder Client walkthrough.
- `docs/auth/scale-roadmap.md` explains how the project will grow beyond Scale 1.
- `docs/Project & feature description/FDD/UPLOAD_IMPLEMENTATION_FDD.md` remains the detailed upload reference.

## 19. Current limitations and risks

### Authentication limitations

1. There is no login, reset, or MFA rate limiting yet.
2. Email ownership is not verified.
3. Passwords currently use an 8-character Scale 1 minimum rather than the later hardened policy.
4. Unknown-user login returns before bcrypt comparison, so timing behavior is not yet equalized.
5. There are no refresh tokens or device-session records.
6. There is no logout or logout-all token revocation.
7. Password reset does not immediately cancel access tokens already issued; they remain valid until expiration.
8. MFA secrets are not yet encrypted at rest.
9. MFA recovery codes are not implemented.
10. A TOTP code may be accepted more than once during its valid time window.
11. Email delivery needs SMTP in production.
12. Local reset-token exposure must remain disabled outside development.
13. There is no authentication security-event log or alerting.
14. There is no third-party OAuth, client registration, consent, or permission-scope system yet.

### Note API limitations

15. Request validation is route-specific rather than handled by one schema-validation layer.
16. `PUT` behaves like `PATCH` and accepts empty updates.
17. Non-array create tags become `[]`; non-array update tags are ignored.
18. Malformed stored tag JSON can break note serialization.
19. There is no pagination, search, filtering, or alternate sorting.

### Upload and storage limitations

20. Each upload is buffered in memory up to 10 MiB; concurrent uploads multiply memory use.
21. File-signature checks are not full parsing, malware scanning, or sanitization.
22. There are no upload quotas per user or note.
23. Explicit image/avatar types require Cloudinary configuration; attachment/document types require S3 configuration.
24. The `/images` naming also represents PDFs and generic attachments.
25. Responses expose provider names, internal storage keys, and original filenames.
26. Provider storage and SQLite cannot be updated atomically.
27. S3 and Cloudinary tests use mocks rather than live provider accounts.
28. Route-level upload validation and rollback are not fully integration-tested.

### Operational limitations

29. There is no graceful server or Prisma shutdown handler.
30. There are no security headers, structured request logs, request IDs, or rate limits.
31. `GET /` checks only HTTP reachability, not database or provider health.
32. `package.json` still names nonexistent `index.js` as `main`, although scripts correctly use `src/server.js`.
33. The `allowScripts` entries name Prisma 7 packages while the installed Prisma version is 5.22.0.
34. SQLite is suitable for this local stage but not a horizontally scaled multi-writer deployment.

## 20. Recommended next steps

The project should now proceed in this order:

1. Perform the complete Thunder Client walkthrough.
2. Decide whether the mentor needs a local demonstration or public HTTPS deployment.
3. Add public-internet protections before treating a deployment as production-ready.
4. Continue the authentication roadmap with validated configuration, consistent errors, rate limiting, and email verification.
5. Add rotating refresh tokens and database-backed sessions.
6. Complete MFA with encrypted secrets and recovery codes.
7. Build third-party access only after the first-party system is stable.

## 21. Snapshot verification

For this refresh, the following were checked:

- All current route registrations.
- Authentication helpers, email service, middleware, and database fields.
- Note and upload route behavior.
- Storage selection, factory, service, and provider implementations.
- Package scripts and dependency versions.
- Environment-variable template.
- Database migration status.
- Authentication and storage test coverage.
- Current authentication documentation.
- Current known limitations.

This document describes the project as it exists on 20 September 2026. It should be refreshed whenever a substantial feature or route behavior changes.
