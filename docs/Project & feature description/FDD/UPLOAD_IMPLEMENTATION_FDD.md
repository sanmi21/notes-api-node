# Upload Implementation: Feature Design & Implementation Document (FDD)

**Date:** 2026 - 9 - 14  
**Status:** Implemented / In Review  
**Module / Scope:** Storage, Note Uploads, Protected File Delivery, Upload Lifecycle  
**Related Master Document:** `../FUNCTIONAL_INVENTORY.md`  
**Document Type:** Feature-specific design and implementation record

---

## 1. Executive Summary & Plain-English Overview

### Problem Statement

The original Notes API stored uploaded images directly in one local `uploads/` directory. The route itself controlled filenames, MIME filtering, file placement, and database creation. That approach supported a basic prototype, but it created several product and engineering limitations:

- Storage was tied to one server's disk.
- Files could not be moved to a cloud provider without rewriting route logic.
- The system had no provider-aware metadata for finding or deleting an object later.
- There was no endpoint for deleting an individual upload.
- Deleting a note removed database records but could leave physical files behind.
- Upload validation trusted client-reported MIME type and filename extension.
- A storage success followed by a database failure could leave an orphan file.
- Remote, private, or expiring file-delivery strategies were unavailable.

This feature replaces that route-bound disk implementation with a provider-neutral storage architecture supporting local storage, S3/S3-compatible storage, and Cloudinary.

### The "Why"

Uploads are no longer just an optional note decoration. They are becoming a reusable product capability for note images, avatars, attachments, and documents. Implementing a storage abstraction now provides:

- **Deployment flexibility:** development can use local disk while production can use managed cloud storage.
- **Scalability:** file bytes do not have to remain permanently on the API server.
- **Privacy:** clients receive a protected API URL rather than relying on a public uploads directory.
- **Lifecycle management:** retrieval and deletion use the provider recorded on each database row.
- **Provider migration support:** records from multiple providers can coexist while defaults change.
- **Safer uploads:** size, business type, MIME type, and file signatures are checked before persistence.
- **Cleaner architecture:** HTTP routing, provider selection, storage operations, and provider SDK code have distinct responsibilities.
- **Testability:** provider behavior can be dependency-injected and tested without real cloud calls.

### Plain-English Analogy

Think of the Notes API as a school office accepting packages for students.

Previously, every package was placed in one cupboard inside the office. The receptionist personally chose the shelf, wrote the label, and later had to remember where the package was. If the school moved buildings, every package-handling rule had to be rewritten.

Now the receptionist gives each package to a storage desk. The storage desk decides whether it belongs in the local cupboard, a secure warehouse called S3, or a media warehouse called Cloudinary. The office keeps a receipt recording where the package went and its unique reference number. When a student asks for the package, the office checks that it belongs to that student and then either hands it over locally or gives the student a temporary secure collection link.

### User Journey

1. The user signs up or logs in and receives a JWT access token.
2. The user creates or selects a note they own.
3. The client submits a multipart request containing an `image` file and, optionally, an `uploadType`.
4. The API confirms the JWT and note ownership.
5. The API checks the upload type, claimed MIME type, size, and leading file bytes.
6. The system chooses local, S3, or Cloudinary storage.
7. The selected provider stores the file privately and returns normalized metadata.
8. Prisma saves the provider, key, size, type, original filename, and metadata against the note.
9. The client receives an API-controlled download URL.
10. When the client opens that URL, the API checks ownership again and either streams the local file or redirects to a protected provider URL.
11. The user can delete the individual upload, or delete the note and trigger cleanup of all its stored files.

### Scope

Included:

- Note-associated uploads.
- Four business upload types: `note-image`, `avatar`, `attachment`, and `document`.
- JPEG, PNG, WebP, GIF, and PDF validation according to upload type.
- Local, S3, and Cloudinary provider implementations.
- Provider-aware database metadata.
- Protected retrieval and individual deletion.
- Provider cleanup during note deletion and failed database creation.
- Unit tests for storage selection, provider contracts, ownership lookup, and legacy compatibility.

Not included:

- A user-profile/avatar route or user avatar relation.
- Video acceptance through the current HTTP route.
- Antivirus scanning, image transformations, thumbnails, or document previews.
- Chunked, streaming, multipart-S3, or resumable uploads.
- User storage quotas or per-note attachment counts.
- Background cleanup/reconciliation jobs.
- CDN policy, content moderation, or retention policies.

---

## 2. Architecture & Data Flow

### High-Level Flow

The implementation separates five concerns:

1. **HTTP and authorization:** Express routes, JWT middleware, and ownership checks.
2. **Transport parsing:** Multer converts one multipart file into an in-memory Buffer.
3. **Business validation:** route helpers validate upload type, MIME allowlist, size, and signature.
4. **Storage orchestration:** the selector, service, and factory choose and call a provider.
5. **Persistence:** Prisma records provider-neutral metadata in `NoteImage`.

### Architectural Diagram / ASCII Map

#### Upload Request Lifecycle

```text
Client
  │ POST /notes/:id/images
  │ Authorization: Bearer <JWT>
  │ multipart: image + optional uploadType
  ▼
authenticateToken
  │ verifies JWT; sets req.user
  ▼
verifyNoteOwnership
  │ validates :id; queries Note by id + userId; sets req.note
  ▼
Multer memoryStorage
  │ buffers at most 10 MiB as req.file.buffer
  ▼
notes.js validation
  │ uploadType → MIME allowlist → business size → byte signature
  ▼
storage.service.storeUpload
  │ default-provider compatibility OR storage.selector
  ▼
storage.factory.getStorage
  ├──────── local ────────► LocalStorage.upload → filesystem
  ├──────── s3 ───────────► S3Storage.upload → PutObject
  └──────── cloudinary ───► CloudinaryStorage.upload → upload_stream
  │
  │ normalized result: provider, key, url, size, MIME, resource type, metadata
  ▼
Prisma NoteImage.create
  │ stores provider-aware record linked to note
  ▼
serializeImage
  │ parses metadata; replaces provider URL with protected API URL
  ▼
201 Created
```

#### Retrieval Lifecycle

```text
Client → GET /notes/:noteId/images/:imageId/file
  → JWT verification
  → validate numeric IDs
  → findOwnedUpload(id + noteId + note.userId)
  → getStoredUploadDownload(record)
      → provider selected from record.provider
      → local: verify path and return filesystem path
      → S3: generate expiring presigned URL
      → Cloudinary: generate signed authenticated URL
  → local: res.sendFile
    remote: HTTP redirect
```

#### Individual Deletion Lifecycle

```text
Client → DELETE /notes/:noteId/images/:imageId
  → JWT verification
  → validate IDs
  → findOwnedUpload(...authenticated user...)
  → deleteStoredUpload(record)
  → Prisma NoteImage.delete
  → 204 No Content
```

#### Note Deletion Lifecycle

```text
Client → DELETE /notes/:id
  → JWT + note ownership
  → load all NoteImage records
  → Promise.all(provider deletions)
  → Prisma Note.delete
  → database cascade deletes NoteImage rows
  → 204 No Content
```

#### Internal Module Map

```text
routes/notes.js
├─ middleware.js                 authentication and note ownership
├─ upload.js                     multipart Buffer creation
├─ utility.js                    API upload serialization
├─ storage/upload-access.js      upload ownership query
└─ storage/storage.service.js    provider-neutral operations
   ├─ storage/storage.selector.js
   ├─ storage/storage.config.js
   └─ storage/storage.factory.js
      ├─ providers/local.storage.js
      ├─ providers/s3.storage.js
      └─ providers/cloudinary.storage.js
```

### Provider Selection Rules

| Request intent | Selected provider |
|---|---|
| Explicit `note-image` | Cloudinary |
| Explicit `avatar` | Cloudinary |
| Explicit `attachment` | S3 |
| Explicit `document` | S3 |
| `uploadType` omitted | Current `STORAGE_PROVIDER`, defaulting to local |

The general selector also supports MIME/size fallback selection for future service callers: image/video goes to Cloudinary, files over 5 MiB go to S3, and remaining files use the configured default. The current route does not use these fallbacks because it either provides an explicit allowed business type or deliberately requests the default provider.

### Design Decisions & Trade-offs

| Decision | Reason and value | Trade-off |
|---|---|---|
| Provider interface behind service/factory | Routes do not contain AWS, Cloudinary, or filesystem SDK logic | More modules and indirection than a single disk-write route |
| Store `provider` and `key` per row | Retrieval/deletion remains correct after the global default changes | More database fields and migration work |
| Protected API URL in responses | Centralizes JWT/ownership enforcement and hides direct delivery policy | Adds an API hop; remote delivery uses a redirect |
| Memory-backed Multer | Every provider receives the same Buffer contract; validation happens before persistence | Up to 10 MiB per concurrent upload is held in process memory |
| Explicit business upload types | Storage policy expresses product intent instead of leaking provider names into clients | `avatar` and PDF types currently sit behind `/images` and `NoteImage` naming |
| Omitted-type default-provider path | Preserves local/legacy behavior and makes development simple | An omitted `uploadType` labeled `note-image` can use a different provider than an explicit `note-image` |
| UUID keys and MIME-derived extensions | Avoids filename collisions and distrusts user filename extensions | Original filenames must be stored separately for display |
| Minimal file-signature checks | Detects simple MIME spoofing without a heavyweight parser | Does not prove a complete, benign, or decodable file |
| Private S3/Cloudinary delivery | Avoids permanent public object URLs | Requires valid provider credentials and signed URL generation |
| Synchronous provider + database workflow | Simple request semantics and immediate consistency in the successful case | No atomic transaction across external storage and SQLite |
| Provider instances cached by factory | Avoids rebuilding SDK clients on every request | Runtime environment changes require cache clear or restart |
| Dependency injection in providers/factory | Enables deterministic tests without real cloud traffic | Provider constructors accept additional test-oriented plumbing |

---

## 3. Environment & Configuration

### New / Updated Environment Variables

| Variable | Required? | Example / Default | Description |
| :--- | :--- | :--- | :--- |
| `STORAGE_PROVIDER` | No | `local` | Default provider when the client omits `uploadType`; supported: `local`, `s3`, `cloudinary` |
| `LOCAL_UPLOAD_DIR` | No | `uploads` | Local storage root, resolved from the process working directory |
| `LOCAL_UPLOAD_URL` | No | `/uploads` | Stored URL prefix for local records; client responses still use the protected API URL |
| `S3_BUCKET` | Yes for S3 | `my-private-bucket` | Destination bucket |
| `S3_REGION` | Yes for S3 | `eu-west-1` | AWS/S3-compatible region |
| `S3_ACCESS_KEY` | Conditional | Empty | Explicit access key; if omitted with secret, the AWS SDK may use its credential provider chain |
| `S3_SECRET_KEY` | Conditional | Empty | Explicit secret paired with `S3_ACCESS_KEY` |
| `S3_ENDPOINT` | No | Empty | Custom endpoint for MinIO, R2, DigitalOcean Spaces, or another compatible service |
| `S3_FORCE_PATH_STYLE` | No | `false` | Uses path-style addressing only when exactly `true` |
| `S3_SIGNED_URL_EXPIRES_IN` | No | `300` | Presigned download lifetime in seconds |
| `CLOUDINARY_CLOUD_NAME` | Yes for Cloudinary | Empty | Cloudinary account cloud name |
| `CLOUDINARY_API_KEY` | Yes for Cloudinary | Empty | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Yes for Cloudinary | Empty | Cloudinary API secret |
| `CLOUDINARY_FOLDER` | No | `notelify` | Default folder when a caller does not provide a route-specific folder |

Existing variables still required by the surrounding API:

| Variable | Required? | Example / Default | Description |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Yes | `file:./dev.db` | SQLite connection used by Prisma |
| `JWT_SECRET` | Yes | Long random secret | Signs and verifies protected-route JWTs |
| `PORT` | No | `5000` | HTTP server port |

The checked-in `.env.example` documents these names without real credentials. The current local `.env` contains only the three core variables; therefore local storage is the active default, and explicit S3/Cloudinary upload types require additional configuration.

### Third-Party Dependencies Added

| Package | Version | Purpose |
|---|---:|---|
| `@aws-sdk/client-s3` | `3.1131.0` | `PutObject`, `GetObject`, `DeleteObject`, and lazy S3 client creation |
| `@aws-sdk/s3-request-presigner` | `3.1131.0` | Time-limited private S3 download URLs |
| `cloudinary` | `2.11.0` | Authenticated streaming upload, signed delivery, metadata, and deletion |

Multer already existed but changed from disk storage to `memoryStorage`, and its absolute limit changed from 5 MiB to 10 MiB. The project test script changed from a failing placeholder to Node's built-in `node --test` runner.

### Provider Configuration Behavior

- Unsupported provider names raise `StorageConfigError` with HTTP-oriented status `500`.
- S3 checks for bucket and region before operations.
- Explicit S3 credentials are used only when both key and secret are present.
- Cloudinary checks all three credentials before configuration.
- Provider clients/configuration are lazy; application startup does not prove a remote provider is usable.
- Normal provider instances are cached. Restart the process after changing provider environment values.

---

## 4. Database & Data Modeling

### Schema Updates / Migrations

No new model was introduced. The existing `NoteImage` model was expanded from local-image metadata into provider-aware upload metadata.

Current Prisma model:

```prisma
model NoteImage {
  id           Int      @id @default(autoincrement())
  url          String   // Legacy/provider URL; API responses use the protected route
  provider     String   @default("local")
  key          String?
  originalName String?
  fileSize     Int
  mimeType     String
  resourceType String?
  metadata     String   @default("{}")
  uploadType   String   @default("note-image")
  noteId       Int
  note         Note     @relation(fields: [noteId], references: [id], onDelete: Cascade)
  createdAt    DateTime @default(now())
}
```

Migration `20260913000000_add_storage_provider/migration.sql`:

```sql
ALTER TABLE "NoteImage" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "NoteImage" ADD COLUMN "key" TEXT;
ALTER TABLE "NoteImage" ADD COLUMN "originalName" TEXT;
ALTER TABLE "NoteImage" ADD COLUMN "resourceType" TEXT;
ALTER TABLE "NoteImage" ADD COLUMN "metadata" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "NoteImage" ADD COLUMN "uploadType" TEXT NOT NULL DEFAULT 'note-image';
```

### Field Responsibilities

| Field | Responsibility |
|---|---|
| `url` | Legacy/provider URL. Required for backward compatibility; S3 inserts an empty string when no durable provider URL exists |
| `provider` | Provider to use for future download and deletion, independent of the current default |
| `key` | Provider-native lookup key/public ID/path key |
| `originalName` | User-facing original filename; never used as the local disk path |
| `fileSize` | Stored byte size |
| `mimeType` | Validated claimed content type |
| `resourceType` | Provider category: `image`, `video`, or `raw` |
| `metadata` | JSON text such as Cloudinary width, height, and format |
| `uploadType` | Product intent: note image, avatar, attachment, or document |
| `noteId` | Parent note and ownership chain |

### Relationships & Indexes

```text
User 1 ──────< Note 1 ──────< NoteImage
```

- `NoteImage.noteId` references `Note.id`.
- `onDelete: Cascade` removes upload rows when a note row is deleted.
- The migration introduces no new index or unique constraint.
- Provider keys are not declared unique at the database layer.
- Ownership is resolved through `NoteImage → Note → User` in Prisma queries.

### Backward Compatibility

The migration defaults old rows to `provider = local`, `metadata = {}`, and `uploadType = note-image`. `key` may remain null for legacy records. `storageKey` then derives the filename with `path.basename(record.url)`, allowing old `/uploads/<filename>` rows to remain retrievable/deletable.

### Consistency Boundary

SQLite and external storage cannot participate in one transaction. The implementation reduces orphan risk but cannot eliminate every partial-failure state:

- Upload: provider success followed by database failure triggers compensating provider deletion.
- Individual delete: provider deletion occurs before database-row deletion.
- Note delete: all provider deletions occur before note/database cascade deletion.

These are deliberate synchronous compensation patterns, not atomic distributed transactions.

---

## 5. Endpoints & Route Definitions

All routes below are mounted below `/notes` and inherit router-level JWT authentication.

Common authentication failures:

| Status | Cause |
|---:|---|
| `401` | Missing access-token segment |
| `403` | Invalid or expired JWT |

### Upload a File

**HTTP Method & URL:** `POST /notes/:id/images`  
**Authentication / Authorization:** JWT required; `:id` must identify a note owned by the token's user  
**Content Type:** `multipart/form-data`

Request fields:

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `image` | File | Yes | File Buffer parsed by Multer |
| `uploadType` | Text | No | `note-image`, `avatar`, `attachment`, or `document` |

Example:

```http
POST /notes/42/images
Authorization: Bearer <token>
Content-Type: multipart/form-data

image=@diagram.png
uploadType=note-image
```

Success: `201 Created`

```json
{
  "id": 17,
  "url": "/notes/42/images/17/file",
  "provider": "cloudinary",
  "key": "notes/42/9f06b27e-9fdf-4f50-9c92-8bf4f8115b4c",
  "originalName": "diagram.png",
  "fileSize": 48123,
  "mimeType": "image/png",
  "resourceType": "image",
  "metadata": {
    "width": 1280,
    "height": 720,
    "format": "png"
  },
  "uploadType": "note-image",
  "noteId": 42,
  "createdAt": "2026-09-14T12:00:00.000Z"
}
```

Error responses:

| Status | Cause / message |
|---:|---|
| `400` | Invalid note ID |
| `400` | No `image`: `No image attached` |
| `400` | Unsupported `uploadType`: `Invalid upload type` |
| `400` | MIME not allowed for type |
| `400` | File above the 5/10 MiB business limit |
| `400` | File bytes do not match claimed MIME |
| `400` | Multer absolute limit or other multipart error |
| `404` | Owned note not found |
| `500` | Provider not configured or unexpected upload/database failure |

### List Notes — Modified

**HTTP Method & URL:** `GET /notes`  
**Authentication / Authorization:** JWT required

The route now returns note summaries without image arrays. This prevents every list request from loading all upload metadata.

Success: `200 OK`

```json
[
  {
    "id": 42,
    "title": "Architecture notes",
    "content": "...",
    "tags": ["storage"],
    "userId": 7,
    "createdAt": "2026-09-14T12:00:00.000Z",
    "updatedAt": "2026-09-14T12:00:00.000Z"
  }
]
```

Unexpected database or tag-parsing errors return `500`.

### Retrieve One Note — Modified

**HTTP Method & URL:** `GET /notes/:id`  
**Authentication / Authorization:** JWT required; owned note only

The route explicitly loads upload records and serializes them into the note response.

Success: `200 OK` with the note and `images: []`. Errors: `400` invalid ID, `404` absent/foreign note, `500` query or serialization failure.

### List a Note's Uploads — Modified

**HTTP Method & URL:** `GET /notes/:id/images`  
**Authentication / Authorization:** JWT required; owned note only  
**Request Payload:** none

Success: `200 OK` with an array of serialized upload records. Errors: `400`, `404`, or `500`. Ordering is not explicitly defined.

### Retrieve an Upload — Modified

**HTTP Method & URL:** `GET /notes/:noteId/images/:imageId/file`  
**Authentication / Authorization:** JWT required; image ID, note ID, and authenticated owner must all match

Success behavior:

| Provider | HTTP behavior |
|---|---|
| Local | Express streams the file using `sendFile` |
| S3 | Redirect to a temporary presigned URL |
| Cloudinary | Redirect to a signed authenticated-delivery URL |

Errors:

| Status | Cause |
|---:|---|
| `400` | Invalid note/image ID |
| `404` | No owned record or missing local file |
| `500` | Provider configuration or retrieval failure (`Unable to retrieve file`) |

### Delete One Upload — New

**HTTP Method & URL:** `DELETE /notes/:noteId/images/:imageId`  
**Authentication / Authorization:** JWT required; image/note/user ownership query  
**Request Payload:** none

Success: `204 No Content`.

Errors: `400` invalid IDs, `404` image not found/owned, or provider status/`500 Unable to delete file`.

The provider object is deleted before its database row.

### Delete a Note — Modified

**HTTP Method & URL:** `DELETE /notes/:id`  
**Authentication / Authorization:** JWT required; owned note only

The route now queries all upload records and deletes their provider objects before deleting the note. SQLite then cascades deletion to `NoteImage` rows.

Success: `204 No Content`. Errors: `400`, `404`, or `500 Internal server error`.

---

## 6. Deep Dive: Controllers, Services & Utilities

The project uses route handlers rather than separate controller files. `src/routes/notes.js` therefore performs the controller role.

### `src/routes/notes.js`

Responsibilities:

- Registers all note/upload endpoints.
- Orchestrates JWT and note ownership middleware.
- Validates upload type, MIME, business size, and binary signature.
- Calls provider-neutral storage service functions.
- Persists normalized upload metadata with Prisma.
- Runs compensating cleanup after database-create failure.
- Retrieves/deletes uploads with user-scoped ownership.
- Cleans provider objects before deleting a note.
- Converts known provider errors to HTTP responses.

Local helpers:

- `isMimeTypeAllowed(uploadType, mimeType)` applies the route's business allowlists.
- `matchesFileSignature(buffer, mimeType)` recognizes the permitted file headers.

### `src/storage/storage.service.js`

Core orchestration layer:

- `storeUpload(file, options)` chooses either the configured default or business selector, obtains a provider, and uploads.
- `deleteStoredUpload(record)` dispatches to the provider stored on the record.
- `getStoredUploadDownload(record)` obtains a local path or remote redirect.
- `storageKey(record)` supports current `key` fields and legacy local URLs.

This layer prevents routes from knowing provider SDK details.

### `src/storage/storage.selector.js`

Encodes storage policy. It distinguishes product intent from provider names, validates the four accepted upload types, and supplies future MIME/size fallback behavior.

### `src/storage/storage.factory.js`

Validates provider names, creates the matching provider class, caches normal instances, bypasses caching for dependency-injected tests, and exports `clearStorageCache`.

### `src/storage/storage.config.js`

Builds one normalized configuration object from environment variables. It resolves local paths safely, normalizes the default provider to lowercase, strips a trailing slash from the local public URL, converts S3 expiry to a number, and defines a status-aware configuration error.

### `src/storage/providers/local.storage.js`

Implements:

- Buffer requirement.
- UUID names and MIME-derived extensions.
- Sanitized note folders.
- Recursive directory creation.
- Exclusive writes (`wx`) to avoid replacement.
- Safe key resolution that rejects absolute paths and traversal.
- File access checks for download.
- Idempotent handling of a missing delete target.

### `src/storage/providers/s3.storage.js`

Implements:

- Required bucket/region validation.
- Lazy `S3Client` creation.
- Optional explicit credentials, endpoint, and path-style mode.
- `PutObjectCommand` with content type and encoded original-name metadata.
- `DeleteObjectCommand`.
- `GetObjectCommand` plus `getSignedUrl` for private delivery.

### `src/storage/providers/cloudinary.storage.js`

Implements:

- Lazy credential validation and SDK configuration.
- Buffer upload through `upload_stream`.
- Authenticated asset type and no overwrite.
- UUID public IDs under a folder.
- Compact width/height/format metadata.
- Provider deletion with invalidation.
- Signed authenticated retrieval URLs.

### `src/storage/upload-access.js`

Contains `findOwnedUpload`, the shared Prisma lookup requiring image ID, note ID, and related note owner. It prevents an authenticated user from accessing another user's upload by guessing IDs.

### `src/upload.js`

Configures Multer `memoryStorage` and a 10 MiB transport ceiling. It deliberately does not write to disk; providers receive the same Buffer contract.

### `src/utility.js`

`serializeImage`:

- Copies the database record.
- Safely parses JSON metadata, falling back to `{}`.
- Overwrites the stored/provider URL with the authenticated API route.

### `src/middleware.js`

Now imports Prisma correctly and keeps note ownership lightweight. It fetches the owned scalar note without loading images; image-aware handlers query those records only when needed.

### `src/app.js`

Adds final error middleware for Multer and forwarded provider/filesystem failures. It standardizes oversized multipart requests to `400` and hides unknown internal error details.

### `prisma/schema.prisma` and the storage migration

Extend `NoteImage` with durable provider identity, lookup key, original filename, resource type, metadata, and upload intent while preserving legacy rows with defaults/nullability.

### `.env.example` and `.gitignore`

The environment template documents every provider option. `uploads/` is now ignored so locally stored user content is not accidentally committed.

### `package.json` and `package-lock.json`

Add AWS/Cloudinary libraries, lock their dependency trees, and enable `node --test`.

### `test/storage.test.js`

Contains 12 tests for provider construction/selection, invalid configuration choices, local lifecycle/path safety, legacy records, provider dispatch, mocked S3, mocked Cloudinary, and ownership scoping. Remote calls are intentionally mocked.

---

## 7. Edge Cases, Security & Error Handling

### Edge Cases Handled

- Missing file returns `400` before storage.
- Unknown upload type returns `400`.
- Business-specific size limits distinguish images from larger documents.
- Multer enforces an absolute 10 MiB ceiling.
- Claimed MIME must match an allowed type and recognized signature.
- Random UUID names prevent collisions and avoid trusting user paths.
- Original names containing traversal characters are metadata only.
- Local storage rejects absolute keys and `..` path segments.
- Exclusive local writes prevent accidental overwrite.
- Legacy local records without a `key` derive one from their stored URL.
- Provider choice is taken from each record for later retrieval/deletion.
- Missing local files produce `404` on retrieval.
- Deleting an already-missing local object is tolerated by the provider.
- Storage success followed by database failure triggers cleanup.
- Invalid note/image identifiers are rejected before database access.
- Ownership checks combine user, note, and image IDs.
- Malformed stored metadata becomes `{}` rather than breaking responses.

### Security Considerations

- All upload routes require a verified JWT.
- Note and upload ownership are enforced at query time.
- No Express static route publicly exposes local uploads.
- API responses use a protected download URL.
- S3 uses presigned retrieval rather than a permanent public object URL.
- Cloudinary assets use authenticated delivery and signed URLs.
- Cloud credentials remain environment variables and are not returned.
- MIME and signature checks reduce simple content-type spoofing.
- Local paths use generated UUIDs and traversal-safe resolution.
- Provider uploads are marked private/authenticated where supported.

### Error and Cleanup Strategy

| Failure point | Current reaction |
|---|---|
| Multipart >10 MiB | Global handler returns `400` |
| Route validation | Return `400`; no provider side effect |
| Provider configuration | Status-aware failure, usually `500` |
| Provider upload fails | No DB row; return upload failure |
| DB insert fails after upload | Attempt compensating provider delete |
| Provider delete fails | Preserve DB row/note and return error |
| DB delete fails after provider delete | Return error, but stale row may remain |
| Local retrieval target missing | Return `404 File not found` |

### Known Risks and Deferred Work

1. **No distributed transaction:** storage and SQLite can diverge during partial failures.
2. **Memory pressure:** every concurrent request can hold up to 10 MiB plus overhead.
3. **Basic signature validation only:** headers do not guarantee safe or well-formed content.
4. **No malware scanning or moderation.**
5. **No storage quota, count limit, or rate limit.**
6. **Naming mismatch:** PDF documents and note-linked avatars use `/images` and `NoteImage`.
7. **Explicit type surprise:** explicit `note-image` uses Cloudinary; omitted type uses the configured default.
8. **Response exposure:** provider, internal key, and original filename are returned to clients.
9. **No deterministic upload ordering** in list responses.
10. **Direct database cascades do not delete provider objects.** Future user deletion must call storage cleanup.
11. **No background reconciliation** for orphan provider objects or stale rows.
12. **Remote provider integration is mocked in tests**, not verified against live accounts.
13. **Route integration coverage is absent** for Multer, JWT, signature validation, and rollback behavior.
14. **Cached providers retain startup configuration** until restart/cache clear.
15. **Nonnumeric S3 expiry is not validated** before passing through the configuration.

---

## 8. Verification & How to Test

### Verification Completed for This Implementation

On 2026 - 9 - 14:

- `npm test` completed with 12 tests passed and 0 failed.
- Syntax checking passed for all 16 application/test JavaScript files.
- The local SQLite database contained all new `NoteImage` columns.
- Migration `20260913000000_add_storage_provider` was marked completed.
- The generated Prisma client schema contained the provider-aware fields.
- Installed AWS SDK and Cloudinary versions matched the lockfile.

What this proves:

- Storage policy and provider construction behave as unit-tested.
- Local upload/retrieve/delete behavior works in a temporary directory.
- Legacy key fallback works.
- Provider-specific dispatch works.
- S3 and Cloudinary normalize results under mocked SDK behavior.
- Ownership lookup produces the correct scoped Prisma filter.

What it does not prove:

- Live S3 or Cloudinary credentials, permissions, CORS, networking, or bucket/account policy.
- Full Express upload and deletion lifecycle under integration tests.
- Real concurrent upload behavior.
- Recovery from process termination between provider and database operations.

### Prerequisites

1. Install dependencies:

```bash
npm install
```

2. Provide core environment values:

```env
DATABASE_URL="file:./dev.db"
PORT=5000
JWT_SECRET=replace-with-a-long-random-secret
```

3. For the simplest local test, omit `uploadType` and use:

```env
STORAGE_PROVIDER=local
LOCAL_UPLOAD_DIR=uploads
LOCAL_UPLOAD_URL=/uploads
```

4. Ensure the provider migration is applied and the generated Prisma client includes the new fields.

5. Start the API:

```bash
npm run dev
```

6. Register/login and copy the returned `access_token`.

Important tooling note: the repository's `prisma.config.ts` imports `prisma/config`, which is unavailable in installed Prisma 5.22.0. The current database and generated client are already updated, but this version mismatch should be resolved before relying on that configuration file for a fresh environment.

### Ready-to-Run Local cURL Example

Create a note or identify an existing owned note, then upload a PNG without `uploadType`. Omitting the type makes the route use `STORAGE_PROVIDER=local`:

```bash
curl -X POST "http://localhost:5000/notes/1/images" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "image=@./sample.png;type=image/png"
```

Expected success: `201` JSON containing `provider: "local"`, a UUID-based `key`, parsed `metadata`, and a protected `url`.

List uploads:

```bash
curl "http://localhost:5000/notes/1/images" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Download/stream one:

```bash
curl -L "http://localhost:5000/notes/1/images/UPLOAD_ID/file" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  --output downloaded-file
```

Delete one:

```bash
curl -i -X DELETE "http://localhost:5000/notes/1/images/UPLOAD_ID" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Expected deletion success: `204 No Content`.

### Explicit Cloudinary Example

After configuring Cloudinary credentials:

```bash
curl -X POST "http://localhost:5000/notes/1/images" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "image=@./sample.webp;type=image/webp" \
  -F "uploadType=note-image"
```

Expected success: `provider: "cloudinary"`. Retrieval returns an HTTP redirect to a signed authenticated URL.

### Explicit S3 Document Example

After configuring S3 bucket/region and credentials or an SDK credential chain:

```bash
curl -X POST "http://localhost:5000/notes/1/images" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "image=@./report.pdf;type=application/pdf" \
  -F "uploadType=document"
```

Expected success: `provider: "s3"`, `resourceType: "raw"`. Retrieval redirects to a temporary presigned URL.

### Common Failure Checks

| Test | Expected result |
|---|---|
| Omit `Authorization` | `401 Access token required` |
| Use expired/invalid token | `403 Invalid or expired token` |
| Use a note belonging to another user | `404 Note not found` |
| Omit the file | `400 No image attached` |
| Use `uploadType=cloudinary` | `400 Invalid upload type` |
| Send PDF as `note-image` | `400 Invalid file type for this upload type` |
| Rename text to `.png` and claim `image/png` | `400 File content does not match its MIME type` |
| Send a 6 MiB valid image | `400 File exceeds the 5 MB limit` |
| Send any file above 10 MiB | `400 File exceeds the 10 MB limit` |
| Explicit `note-image` without Cloudinary config | Provider configuration error (`500`) |
| Retrieve a nonexistent image | `404 Image not found` |

### Automated Tests

Run:

```bash
npm test
```

Current expected summary:

```text
tests 12
pass 12
fail 0
```

### Recommended Next Verification Layer

Before declaring the feature production-ready, add integration tests that start an exported Express app against a disposable database and verify:

1. JWT and ownership behavior for every upload route.
2. Multipart parsing and all MIME/signature/size failures.
3. Successful local upload, protected retrieval, and deletion.
4. Database failure after provider success triggers cleanup.
5. Provider failure prevents database deletion.
6. Note deletion cleans multiple uploads.
7. Cross-user image IDs remain inaccessible.
8. Live sandbox tests for S3 and Cloudinary configuration, permissions, signed retrieval, and deletion.

### Implementation Acceptance Checklist

- [x] Local provider implemented.
- [x] S3 provider implemented.
- [x] Cloudinary provider implemented.
- [x] Provider selection and configuration implemented.
- [x] Provider recorded per upload.
- [x] Legacy local records supported.
- [x] Protected retrieval implemented.
- [x] Individual upload deletion implemented.
- [x] Note-level provider cleanup implemented.
- [x] MIME, size, and signature validation implemented.
- [x] Upload-after-storage database failure cleanup implemented.
- [x] Database migration applied locally.
- [x] Storage unit tests passing.
- [ ] Express route integration tests.
- [ ] Live S3 verification.
- [ ] Live Cloudinary verification.
- [ ] Background reconciliation for partial failures.
- [ ] Production monitoring, quotas, and upload rate limiting.

---

This FDD documents the upload feature as implemented in the current working tree. It records known trade-offs and open verification work without altering the implementation.
