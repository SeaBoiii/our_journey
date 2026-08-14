# Moments API Worker

An independently deployable Cloudflare Worker for the production Moments backend. The static Astro site remains on GitHub Pages; this Worker owns all privileged Google Drive and Supabase operations.

## Security model

- Google OAuth refresh credentials and Supabase service credentials exist only as Worker secrets.
- Guests receive a short-lived signed anonymous token; no guest account, email, or Google login is required.
- Google resumable `Location` URLs are encrypted inside AES-256-GCM upload tickets and never returned in plaintext.
- Every chunk probes Google for the authoritative offset before upload. Drive file IDs are pre-generated, and Supabase completion is deterministic and idempotent.
- Originals remain private in Drive. The API never creates Drive permissions or returns Drive IDs/URLs to guest or admin DTOs.
- Gallery derivatives are metadata-free WebP files in a private Supabase bucket. The Worker returns short-lived signed URLs (15 minutes by default) only for RLS-visible records, and object cache lifetimes are capped to the same configured TTL.
- Derivative objects use fixed per-moment paths and first-write-only storage. An identical lost-response retry is reconciled byte-for-byte; a changed replay cannot overwrite the accepted object or amplify storage.
- Guest gallery reads use the anon/publishable key and database RLS. Admin reads and moderation use the admin's Supabase JWT and RLS. The service role is limited to upload initialization/finalization and private Storage operations.
- Exact origins are allowlisted. `*`, wildcard subdomains, paths, `Origin: null`, and arbitrary reflection are rejected.
- Uploads are throttled by both signed guest ID and hashed Cloudflare client IP. Session issuance and public gallery signing are also IP-throttled.

The defaults intentionally distinguish identities from a venue's shared NAT: uploads allow 120 requests/minute per signed guest and 2,400/minute for the coarse IP safety valve; session issuance plus initialization share a 600/minute entry-IP ceiling; gallery reads allow 1,200/minute per IP. Tune these after the owner test, and add Turnstile at session issuance if abuse appears rather than lowering shared-IP ceilings enough to block wedding Wi-Fi or carrier-CGNAT guests.

Upload tickets are stateless. `DELETE` stops/abandons the client upload but cannot revoke a ticket already issued; tickets expire after two hours, are bound to a separate guest session, and never reveal Google's URL. Incomplete Google resumable sessions do not create Drive files and expire at Google. Add a Durable Object only if hard revocation becomes a requirement; Workers KV is not suitable for strongly coordinated per-chunk state.

If Drive has already completed when a guest cancels, closes the tab, or exhausts
finalization retries, a private original can remain without a Supabase row. The
same tab and selected `File` should retry first while its sealed ticket is still
available. If that state is gone, use this non-destructive owner runbook:

1. In the private Originals/Videos folders, compare each server-generated UUID
   filename (or its `appProperties.momentsId` through the Drive API) with
   `public.moments.id` in Supabase.
2. Treat a file with no matching row as an orphan. Keep it private while you
   inspect the surrounding upload logs/request IDs; do not invent guest text or
   publish a guessed metadata row because the lost sealed ticket contained the
   authoritative name and caption.
3. After confirming that no matching row exists, either retain the file in the
   private archive or remove it manually from Drive. Moments intentionally has
   no automatic or guest-triggered permanent-delete path.

Perform that comparison once before the event after owner testing and again
after the upload window closes. A future Durable Object or scheduled
reconciler can make this automatic if the upload volume justifies it.

The anonymous-session handler is the explicit Turnstile integration point if rate limits are not enough later. Turnstile is intentionally not required for this wedding-sized first deployment; exact CORS is never treated as authentication.

Remote video uploads default to disabled. The same 8 MiB resumable path is implemented, but enable videos only after the owner manual test is proven for the target account and mobile network.

## Routes

All browser routes except health require an exact allowed `Origin`.

| Method | Route | Authentication |
| --- | --- | --- |
| `GET` | `/v1/health` | None |
| `POST` | `/v1/sessions/anonymous` | Origin |
| `POST` | `/v1/uploads/init` | `X-Guest-Session` |
| `PUT` | `/v1/uploads/:sessionId/chunks/:index` | Guest + `X-Moments-Upload-Token` |
| `GET` | `/v1/uploads/:sessionId` | Guest + upload token |
| `POST` | `/v1/uploads/:sessionId/derivatives` | Guest + upload token |
| `POST` | `/v1/uploads/:sessionId/complete` | Guest + upload token |
| `DELETE` | `/v1/uploads/:sessionId` | Guest + upload token |
| `GET` | `/v1/moments` and `/v1/moments/:id` | Origin; database permits approved/ready only |
| `GET` | `/v1/admin/session` and `/v1/admin/moments` | `Authorization: Bearer <Supabase JWT>` |
| `PATCH` | `/v1/admin/moments/:id/status` | Supabase JWT + admin RLS |

`Authorization` is reserved for Supabase admin JWTs. Guest routes use `X-Guest-Session`; upload-session routes additionally use `X-Moments-Upload-Token`. Never put either token in a URL.

### Upload contract

Initialize:

```json
{
  "guestName": "Nadia",
  "caption": "A beautiful moment",
  "files": [{
    "clientFileId": "browser-generated-id",
    "fileName": "IMG_1234.jpg",
    "fileSize": 1234567,
    "mimeType": "image/jpeg",
    "mediaType": "photo"
  }]
}
```

The `201` response is `{ "data": { "uploadId", "files": [{ "clientFileId", "sessionId", "uploadToken", "chunkSize", "nextOffset", "expiresAt" }] } }`.

Send each chunk with `Content-Range: bytes <start>-<end>/<total>`. The response is `{ "data": { "sessionId", "nextOffset", "uploadedBytes", "totalBytes", "complete" } }`. Always resume from `nextOffset`; do not assume a previous request arrived in full.

After the original is complete, an optional multipart `POST .../derivatives` accepts one `gallery` WebP file. The Worker verifies complete still-WebP structure/dimensions, rejects metadata/profile/animation chunks (including EXIF/XMP), caps it at 1600 px/5 MiB, and returns a replacement `uploadToken`. Use that replacement for completion. The response retains both `gallery` and `thumbnail` descriptors, but both deliberately refer to this same canonical image: an untrusted guest cannot show moderators a benign thumbnail and publish different gallery bytes. A future trusted processor may create the smaller thumbnail. If a browser cannot create a safe derivative (notably HEIC), skip this call; completion stores `processing_status=pending` for that processor.

The Worker does not attest that this guest-supplied canonical WebP was derived
from the private Drive original. Moderation covers the exact bytes that become
public; archive-to-preview integrity requires owner spot checks or a future
trusted processor that reads and re-encodes the original.

Completion returns `{ "data": { "moment": { "id", "status", "createdAt", "mediaType" } } }`. With moderation enabled the status is `pending`; this does not imply immediate gallery publication.

Drive media metadata is captured as nullable `original_width`/`original_height` when Google has made it available. Database `width`/`height` and public DTO dimensions describe the canonical display derivative; original dimensions may remain null until a future processor refreshes them.

Errors always use:

```json
{
  "error": {
    "code": "FILE_TOO_LARGE",
    "message": "That file is a little too large to upload.",
    "requestId": "...",
    "retryable": false
  }
}
```

No upstream response bodies, SQL details, credentials, stack traces, Drive IDs, or upload URLs are included.

### Public gallery contract

Request `GET /v1/moments?limit=20&offset=0`. The limit is capped at 20 and the offset must be a nonnegative integer no greater than 10,000. The response is `{ "data": { "moments": [], "nextOffset": null } }`; request another page only when `nextOffset` is a number. Guest callers must not send a moderation `status` selector—the API rejects every such parameter and always enforces approved + derivative-ready rows itself. Every public moment includes literal `status: "approved"`. Detail remains `GET /v1/moments/:id`.

### Admin list and moderation contract

Request moderation pages with `GET /v1/admin/moments?status=all&limit=20&offset=0`. `status` may be `all`, `pending`, `approved`, `rejected`, or `hidden`; `limit` is capped at 20 and `offset` must be a nonnegative integer no greater than 10,000. The response is:

```json
{
  "data": {
    "moments": [],
    "nextOffset": null
  }
}
```

When `nextOffset` is a number, request the next page with that authoritative offset. Moderation `PATCH` accepts exactly `{ "status": "..." }` and rejects extra keys. Valid transitions are pending to approved/rejected, approved to hidden/rejected, rejected to pending, and hidden to approved. Any transition into `approved` additionally requires `processing_status=ready`, positive display dimensions, and the canonical gallery/thumbnail paths; a direct or stale client cannot pre-approve an unfinished moment.

## Local setup and tests

```sh
cd workers/moments-api
npm install
cp .dev.vars.example .dev.vars
npm test
npm run check
npm run dev
```

The `node:test` suite mocks Google and Supabase. It does not create cloud resources or upload real files.

## Google owner authorization

Use the repository's canonical setup guide at [`../../docs/GOOGLE_DRIVE_MOMENTS.md`](../../docs/GOOGLE_DRIVE_MOMENTS.md). It uses a Google **Desktop app** OAuth client and the loopback callback `http://127.0.0.1:53682`.

From the repository root, set the client credentials in your local shell and run:

```sh
npm run oauth:google -- --create-folders
```

The helper requests `https://www.googleapis.com/auth/drive.file`, obtains the owner refresh token, and creates the compatible private folder tree. Follow the guide for copying its refresh token and folder IDs into Worker secrets. This Worker deliberately does not maintain a second OAuth helper or setup flow.

There is no public OAuth callback in the wedding experience.

## Supabase requirements

- Run the repository Moments migration before deploying.
- Keep the `moments-gallery` bucket private.
- RLS must expose approved + derivative-ready rows only to anon, authorize only active `moment_admins` for authenticated moderation, and prevent guest inserts/updates.
- Disable public signup. Create/invite the owner in Supabase Auth, then insert that user's UUID into `moment_admins` through the SQL editor/service setup.
- `SUPABASE_ANON_KEY` accepts the legacy anon JWT or current publishable equivalent. `SUPABASE_SERVICE_ROLE_KEY` accepts the legacy service-role JWT or current secret equivalent; both remain server-side here except the browser-safe public auth key used separately by Astro.

## Deploy to `workers.dev`

A Cloudflare Free account with Workers enabled is sufficient for this wedding-sized deployment. Authenticate with `npx wrangler login`; on the first deployment, follow Cloudflare's prompt to register the account's `workers.dev` subdomain if it does not exist yet. Then set secrets:

```sh
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID
npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
npx wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN
npx wrangler secret put GOOGLE_DRIVE_ORIGINALS_FOLDER_ID
npx wrangler secret put GOOGLE_DRIVE_VIDEOS_FOLDER_ID
npx wrangler secret put MOMENTS_SESSION_SECRET
npm run deploy
```

Set `MOMENTS_ALLOWED_ORIGINS` to comma-separated exact origins. GitHub's value is `https://seaboiii.github.io` (the `Origin` header does not contain `/our_journey`). Add exact localhost origins and an exact `pages.dev` preview hostname only when needed—never a wildcard.

Set the Astro build's `PUBLIC_MOMENTS_API_URL` to the resulting `https://<worker>.<account>.workers.dev` URL and select the remote provider. No private Worker value belongs in a `PUBLIC_` variable.

## Optional owner integration test

After deployment, intentionally upload one JPEG between 9 and 15 MiB so the test crosses the 8 MiB boundary and exercises Cloudflare's fixed-length streaming path:

```sh
node scripts/manual-upload.mjs https://<worker>.<account>.workers.dev ./owner-test-9mb.jpg https://seaboiii.github.io
```

This creates a private Drive original and a pending Supabase row. It intentionally does not delete either and does not run in CI. Review/remove the clearly labelled owner integration record manually if desired.
