# Moments

Moments is the guest-photo chapter of Aleem and Ain's wedding experience. It
shares the invitation's typography, palette, sky, cloud, and ornament assets,
while keeping its routes, React islands, storage, styles, and state separate.

Routes:

- `/moments/` — landing experience
- `/moments/capture/` — camera/gallery selection and upload
- `/moments/gallery/` — approved moments and full-screen viewer
- `/moments/admin/` — local mock moderation or authenticated remote moderation
- `/moments/live/` — Phase 3 projector-mode shell

## Runtime modes

The same frontend supports two providers:

| Mode | Build value | Behavior |
| --- | --- | --- |
| Mock | `PUBLIC_MOMENTS_BACKEND_PROVIDER=mock` | IndexedDB originals and metadata in the current browser; no accounts or cloud credentials. |
| Remote | `PUBLIC_MOMENTS_BACKEND_PROVIDER=remote` | Cloudflare Worker API coordinating private Google Drive originals and Supabase metadata/auth/derivatives. |

Mock is the default and remains the safe GitHub Pages/local-development mode.
Remote mode also requires `PUBLIC_MOMENTS_API_URL`, `PUBLIC_SUPABASE_URL`, and
`PUBLIC_SUPABASE_ANON_KEY`. The Supabase values are browser-safe and are used
only for the admin magic-link session; all data operations still pass through
the Worker.

The frontend keeps one boundary in both modes:

```text
Capture / Gallery / Admin UI
            ↓
   Moments service facade
            ↓
      mock OR remote provider
```

Google Drive and Supabase are not alternative frontend providers. They are two
private responsibilities behind the one remote API.

## Phase 2 remote architecture

```text
Guest browser
  ├─ signed anonymous guest session
  ├─ bounded original chunks
  └─ metadata-free WebP derivatives where the browser can decode the photo
              ↓
Cloudflare Worker (security boundary)
  ├─ exact-origin CORS and rate limiting
  ├─ metadata, extension, size, MIME and first-byte validation
  ├─ opaque encrypted upload tickets
  ├─ Google OAuth refresh and Drive resumable upload proxy
  ├─ private Supabase Storage derivative writes/signing
  └─ RLS-backed gallery/auth/moderation requests
       ├─ Google My Drive: private full-quality originals
       └─ Supabase: metadata, Auth, moderation and private derivatives
```

Private values exist only in the Worker environment. The static Astro bundle
never receives Google credentials, the Supabase service-role key, Drive file
IDs, Drive upload URLs, or admin allow-list data.

### Resumable original uploads

1. The browser requests a short-lived signed anonymous guest session.
2. It initializes all file descriptors together, allowing the Worker to enforce
   the per-submission count and text limits.
3. The Worker refreshes the owner's Google OAuth access token, pre-generates
   private Drive file IDs, and opens resumable uploads in the configured folder.
4. The private Drive session URI and immutable metadata are encrypted into an
   opaque, expiring upload ticket. The browser never receives the URI in plain
   text and never puts the ticket in a URL.
5. The browser uploads 8 MiB chunks through the Worker. Before each chunk, the
   Worker asks Drive for the authoritative accepted offset. Lost responses and
   retries therefore resume rather than duplicate data.
6. Only the first bounded chunk is buffered for magic-byte validation; later
   chunks are streamed to Drive. The Worker never buffers a 150 MB original.
7. Completion is idempotent by server-generated moment ID and pre-generated
   Drive file ID. A successful response contains upload receipts, never a Drive
   URL.

Client cancellation aborts the active network request and abandons the short-
lived sealed ticket. This stateless design avoids KV/Durable Object setup on the
free plan. It does not provide a hard server-side ticket revocation list; an
incomplete Drive session contains no finished file and expires. If hard
revocation or strict per-session serialization becomes necessary, a Durable
Object is the documented upgrade path.

A cancellation or finalization failure that occurs after Drive has already
finished can leave a private original without a Supabase row. The Worker README
contains the owner reconciliation runbook: compare the server UUID filename (or
Drive `appProperties.momentsId`) with `public.moments.id`, preserve the file
while investigating, and only archive/delete it manually after confirming the
row is absent. Guest metadata is not guessed after a sealed ticket is lost.

Remote videos default to disabled. The resumable protocol and Videos folder are
present, but production video enablement should follow the manual integration
test and operational review. Mock mode may continue to preview videos locally.

### Derivatives and location privacy

The gallery never loads Google Drive originals.

For JPEG, PNG, and WebP photos a browser-side canvas creates a canonical gallery
WebP bounded to approximately 1600 px. Canvas re-encoding excludes the source
EXIF payload, including GPS metadata. The Worker independently verifies strict
still-WebP structure, dimensions, and the absence of metadata/animation chunks
before writing it to the private `moments-gallery` Supabase bucket.

In remote Phase 2, both the gallery and thumbnail paths deliberately reference
that same verified object. An independently guest-supplied thumbnail could show
a moderator different pixels from the eventual lightbox image, so it is not a
trusted optimization. A future trusted media processor may generate a separate
approximately 640 px thumbnail and atomically update the metadata row. Mock mode
keeps its existing local thumbnail fixtures.

The browser-produced WebP is still untrusted input. The Worker proves that the
moderator preview and public gallery bytes are identical and safe in structure,
but it cannot prove that those pixels were derived from the private Drive
original. Approval therefore attests the canonical public image, not the
integrity of the archived original. Spot-check originals after the event, or
add a trusted server-side processor before treating Drive as a verified archive.

HEIC/HEIF originals can still reach the private Drive archive when the browser
cannot decode them, but their metadata remains `processing_status=pending`
until a trusted processor creates derivatives. Approving a moment never makes
it public unless processing is also ready and both derivative paths exist.

Gallery/admin responses receive short-lived signed derivative URLs. A signed
URL remains usable until its expiry even if the row is hidden in the meantime;
the default is 15 minutes. A future Worker media proxy can provide immediate
revocation if that tradeoff becomes important.

## Guest and admin security

- Guests do not need email, phone, password, Google, or Supabase accounts.
- `guestName` is display metadata, not identity.
- Guest API access uses a server-signed opaque session ID.
- The guest gallery endpoint accepts no moderation-status selector. Supabase RLS
  and column grants expose only approved, derivative-ready rows and never Drive
  IDs, guest-session IDs, or moderation actors.
- Admin sign-in uses Supabase Auth magic links with implicit signup disabled.
- An immutable `auth.users.id` must also appear in `moment_admins`; a valid but
  non-allow-listed user receives Access denied.
- The Worker's admin queries forward the admin JWT to Supabase, so RLS remains a
  second authorization boundary.
- GitHub Pages cannot configure `Content-Security-Policy` response headers, so
  the remote admin gate also refuses to render authentication or moderation
  controls inside a frame. On a future configurable host, additionally send
  `Content-Security-Policy: frame-ancestors 'none'` as the primary browser-level
  clickjacking control.
- Rejecting, hiding, or restoring a moment changes metadata only. There is no
  permanent-delete action and the private Drive original remains untouched.
- The service-role key is used only for trusted upload completion, derivative
  storage/signing, and never appears in browser code.

## Limits

The defaults are centralized in the frontend and independently enforced by the
Worker and database:

- 10 files per submission
- 20 MB per photo
- 150 MB per video when remote video is explicitly enabled
- 80 characters for the guest name
- 500 characters for the caption
- JPEG, PNG, WebP and HEIC/HEIF photos
- MP4 and MOV video architecture, feature-flagged remotely

Browser validation is friendly feedback only. The Worker validates metadata,
extension, declared MIME, bounded request size, and media signature before an
original is accepted.

## Setup order

No real credential is committed. Complete these guides in order:

1. [Supabase setup and RLS](docs/SUPABASE_MOMENTS.md)
2. [One-time Google OAuth and Drive folders](docs/GOOGLE_DRIVE_MOMENTS.md)
3. [Cloudflare Worker setup and deployment](workers/moments-api/README.md)
4. Add the public remote values to the frontend deployment.

Phase 2 owner configuration consists of:

- a Supabase project, migration, private bucket and allow-listed Auth user;
- one Google owner OAuth refresh token and app-created Drive folder IDs;
- a Cloudflare account, Worker secrets, exact allowed origins and deployment;
- GitHub repository variables for the public provider/API/Auth configuration.

See `.env.example` and `workers/moments-api/.dev.vars.example` for names only.

## GitHub Pages

The invitation workflow remains in place. `actions/configure-pages` supplies
`PAGES_BASE=/our_journey/`, and all Moments routes/assets continue to use the
shared base helper.

The workflow defaults to mock mode. To point the GitHub Pages Moments routes at
the Worker, add these browser-safe GitHub repository variables:

```text
PUBLIC_MOMENTS_BACKEND_PROVIDER=remote
PUBLIC_MOMENTS_API_URL=https://<worker-name>.<account>.workers.dev
PUBLIC_MOMENTS_ALLOW_VIDEOS=false
PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
PUBLIC_SUPABASE_ANON_KEY=<publishable-or-anon-key>
```

Do not add Worker secrets to GitHub Pages variables. The current invitation
continues at `/our_journey/`; Moments continues at `/our_journey/moments/`.

For the eventual dedicated frontend, leave `PAGES_BASE` unset and set
`PUBLIC_JOURNEY_URL` to the invitation origin. No custom domain is required for
the Worker or frontend during Phase 2.

## Verification

Frontend and API checks:

```sh
npm run check
npm run test:phase2
npm run build
```

The existing browser audit deliberately exercises mock mode and must remain
available without any cloud account:

```sh
npm run audit:moments -- http://127.0.0.1:4321
```

Worker tests mock Google and Supabase; normal CI never performs a real Drive
upload. The optional owner integration command in the Worker README creates one
small real test upload only when its environment variables are explicitly set.
