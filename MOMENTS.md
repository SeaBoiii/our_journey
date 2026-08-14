# Moments

Moments is the guest photo chapter of Aleem and Ain’s wedding experience. Phase 1 is available at:

- `/moments/` — landing experience
- `/moments/capture/` — camera/gallery selection and mock upload
- `/moments/gallery/` — approved moments and full-screen viewer
- `/moments/admin/` — local mock moderation
- `/moments/live/` — future projector-mode shell

It shares the invitation’s typography, palette, sky, cloud, and ornament assets while keeping its routes, React islands, storage, styles, and state independent.

## Phase 1 architecture

The UI imports the service facade in `src/lib/moments/upload.ts`; it does not import or know about Google Drive, Supabase, or IndexedDB directly.

```text
Capture / Gallery / Admin UI
            ↓
   Moments service facade
            ↓
      provider interface
            ↓
   IndexedDB mock provider
```

Key files:

- `src/config/moments.ts` owns feature flags, wedding mode, accepted media, and file limits.
- `src/lib/moments/types.ts` defines serializable Moments records and provider contracts.
- `src/lib/moments/upload.ts` validates requests, maps provider failures to warm guest-facing messages, and exposes `uploadMoment()`, `getMoments()`, `deletePendingUpload()`, and `updateMomentStatus()`.
- `src/lib/moments/providers/mock.ts` is the only Phase 1 adapter.
- `src/lib/moments/gallery.ts` owns approved/newest-first filtering, alt text, and object-URL cleanup.
- `src/lib/paths.ts` resolves both assets and routes from Astro’s `BASE_URL`, so local/root and GitHub project builds use the same UI code.
- `src/data/wedding.ts` remains the single source of truth for public couple/date/event metadata used by both the invitation and Moments.

The default limits are 20 MB per photo, 150 MB per video, and 10 files per submission. JPEG, PNG, WebP, HEIC/HEIF, MP4, and MOV are accepted. A browser may upload HEIC/HEIF even when it cannot render a local preview.

### Mock persistence

Uploaded `Blob` objects and metadata are stored in a versioned, Moments-only IndexedDB database. They are not written to localStorage, the Git repository, GitHub, Google Drive, or Supabase. This makes the capture → admin → gallery flow genuinely testable across normal page navigation.

Mock data is origin-local. A submission created on `localhost`, GitHub Pages, or a future `pages.dev` domain will not appear on the other origins. Clearing site data removes it. Generated demo images under `public/assets/moments/mock/` are fictional layout fixtures, not real guests or the real couple.

The guest gallery requests approved records by default. The mock admin explicitly asks for all statuses and can approve, reject, or hide records in the current browser. This is a UI preview, not a security boundary.

## Security boundary

Everything bundled by Astro or exposed through a `PUBLIC_` environment variable is public. Never put any of the following in client source or browser-visible environment variables:

- Google OAuth client secrets or refresh tokens
- Supabase service-role keys
- admin credentials or hard-coded passwords

There is deliberately no frontend password check on `/moments/admin/`. Future moderation will use Supabase Auth and server-enforced authorization.

## Future Google Drive and Supabase integration

The intended production backend is hybrid rather than choosing Google Drive or Supabase as mutually exclusive storage providers:

```text
Guest browser
    → authenticated/rate-limited upload request
Cloudflare Worker or Pages Function
    → validate type, size, count, and guest session
    → initiate/relay bounded chunks for resumable upload
Google Drive (OAuth as the owning human account)
    → store full original in Originals or Videos
Media processing
    → create bounded WebP/AVIF gallery derivatives
Supabase
    → store metadata, moderation status, session, admin auth, and derivative URLs
Gallery
    → read approved metadata/derivatives only
```

For a personal `My Drive`, production uploads should authenticate with OAuth 2.0 on behalf of the Google account that owns the wedding folders. The OAuth client secret and refresh token belong only in the serverless environment. Do not put them in browser code.

The upload API must not assume a single request can proxy every configured video. Cloudflare Free currently limits request bodies to 100 MB while the Phase 1 video limit is 150 MB, so Phase 2 should use Google Drive resumable uploads with bounded chunks rather than sending an entire large video through one Worker request.

Large originals should never be returned for masonry cards. Gallery pages should use optimized derivatives while the full originals remain in Drive.

A production remote provider can implement the existing `MomentsProvider` contract and be selected by the facade without rewriting React components. In production, approved-only filtering and moderation authorization must be enforced by the API/database policies—not trusted to a client parameter.

## Environment variables

Phase 1 requires none. Copy `.env.example` only when testing the optional cross-domain journey link.

Browser-safe values:

| Variable | Purpose |
| --- | --- |
| `PUBLIC_JOURNEY_URL` | Invitation origin after Moments is deployed separately. Falls back to the current Astro base. |
| `PUBLIC_MOMENTS_API_URL` | Proposed future public upload/read API origin. Not consumed in mock mode. |
| `PUBLIC_SUPABASE_URL` | Proposed future Supabase project URL if the browser client needs it. |
| `PUBLIC_SUPABASE_ANON_KEY` | Proposed future anonymous key; safe to expose only with correct RLS policies. |

Serverless-only values should be configured in Cloudflare’s encrypted environment and must never use the `PUBLIC_` prefix. Examples are `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, and the Drive folder IDs shown in `.env.example`.

## Deployment

### Existing GitHub Pages invitation

The current workflow remains unchanged. It obtains the repository base path from `actions/configure-pages` and builds with `PAGES_BASE=/our_journey/`. Moments is therefore testable at `https://seaboiii.github.io/our_journey/moments/` without breaking the invitation root.

To reproduce that build locally:

```powershell
$env:PAGES_SITE='https://seaboiii.github.io'
$env:PAGES_BASE='/our_journey/'
npm run build
```

No Moments component hard-codes `/our_journey/`.

### Future Cloudflare Pages preview

Create a separate Cloudflare Pages project pointed at this repository with:

- Build command: `npm run check && npm run build`
- Output directory: `dist`
- Node.js: 24 (or another version satisfying `>=22.12.0`)
- `PAGES_BASE`: unset

The initial preview will be available at `https://<project>.pages.dev/moments/`. The build also contains the invitation because this is still one repository; a later deployment-only root rewrite or a small Moments-specific Astro entry can make the dedicated domain open Moments at `/` without changing its service/business logic. Set `PUBLIC_JOURNEY_URL` to the invitation origin when the experiences move to separate domains.

Real uploads require a Cloudflare Worker/Pages Function or another secure external API. This static Astro build must never be given private OAuth or service credentials.

## Verification

With a local server running, the browser audit exercises capture, IndexedDB persistence, moderation, gallery visibility, lightbox keyboard behavior, base-aware links, and horizontal overflow:

```sh
npm run audit:moments -- http://127.0.0.1:4321
```

For a GitHub-base preview, pass the full base URL (for example `http://127.0.0.1:4321/our_journey`). Existing invitation audits remain independent.
