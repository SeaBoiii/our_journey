# Supabase setup for Wedding Moments

Supabase has three narrowly defined responsibilities in the production
Moments architecture:

- metadata and moderation state for each uploaded file;
- authentication and authorization for the small administrator group;
- private storage for optimized, metadata-stripped gallery derivatives.

Full-quality guest originals do not belong in Supabase Storage. They remain
private in the configured Google Drive folders. The Cloudflare Worker is the
only service that coordinates Google Drive with Supabase and the only service
that receives the Supabase service-role credential.

## What the migration creates

Apply
`supabase/migrations/202608140001_moments.sql` to create:

- `public.moments`, containing internal original metadata, public derivative
  paths, moderation state, processing state, and audit fields;
- `public.moment_admins`, a small allowlist keyed by immutable
  `auth.users.id` values;
- the private `moments-gallery` Storage bucket for WebP or AVIF derivatives;
- database constraints, indexes, column grants, Row Level Security policies,
  and the moderation audit trigger.

Moderation and derivative processing are intentionally separate:

- `status`: `pending`, `approved`, `rejected`, or `hidden`;
- `processing_status`: `pending`, `ready`, or `failed`.

A guest-facing database read returns a row only when it is both `approved` and
`ready`, and both derivative paths exist. Approving a row cannot accidentally
publish an unprocessed original. The authenticated status-update policy also
refuses an `approved` row unless the current Phase 2 canonical gallery/thumbnail
path is present, processing is ready, and both display dimensions are positive;
the Worker enforces the same invariant before it sends the database update.

The public `width` and `height` fields describe the canonical display
derivative so the gallery can reserve the correct aspect ratio. Separate
internal `original_width` and `original_height` fields come from Google Drive's
output-only media metadata when available. Drive may not populate that metadata
immediately, so the original pair is nullable and is never inferred from an
untrusted browser declaration.

The migration enforces the frontend's current limits at the database boundary:

- guest name: 1–80 characters after trimming;
- caption: at most 500 characters;
- original photo: at most 20 MiB;
- original video: at most 150 MiB;
- accepted photo and video MIME types matching the Moments domain model.

These constraints are a final safeguard. The Worker must still reject invalid
metadata and inspect the actual file signature before creating a Drive file or
a database row.

## Access model

| Caller | Credential sent to Supabase | Effective access |
| --- | --- | --- |
| Public gallery route in the Worker | anon/publishable key | Approved, derivative-ready safe columns only |
| Signed-in non-admin | anon/publishable key plus user JWT | No direct Moments rows |
| Signed-in authorized admin | anon/publishable key plus user JWT | Safe columns for every status; update `status` only |
| Trusted Worker upload/processing code | service-role key | Insert internal metadata, update processing fields, upload/sign derivatives |

The public gallery query must use the legacy anon key or its newer publishable
equivalent so that RLS is actually evaluated. Both map an unauthenticated Data
API request to the Postgres `anon` role. A service-role or secret-key request
bypasses RLS and must not be used for guest gallery reads.

For moderation requests, the Worker validates the Supabase access token and
forwards that user JWT to Supabase with the anon/publishable API key. The
database then performs the administrator membership check. The Worker must
return:

- `401` for an absent, expired, or invalid user session;
- `403` for a valid Supabase user who has no active administrator row.

The service-role key is not needed for a normal moderation update. Keeping the
user JWT attached means RLS and the database audit trigger remain the final
authorization and attribution boundary.

## 1. Create and link a Supabase project

1. Create a project in the [Supabase dashboard](https://supabase.com/dashboard).
2. Record the project reference and choose an appropriate nearby region.
3. Install the Supabase CLI or use it through `npx`.
4. If `supabase/config.toml` does not exist yet, initialize the repository's
   local Supabase configuration once:

   ```sh
   npx supabase@latest init
   ```

5. From the repository root, authenticate and link the project:

   ```sh
   npx supabase@latest login
   npx supabase@latest link --project-ref <PROJECT_REF>
   ```

6. Review the migration, then apply it:

   ```sh
   npx supabase@latest db push
   ```

The SQL can instead be pasted into the dashboard SQL Editor, but `db push`
keeps the applied schema tied to the versioned repository migration.

After applying it, confirm in the dashboard that:

- RLS is enabled on both `moments` and `moment_admins`;
- `moments-gallery` exists and is marked **Private**;
- the bucket allows only `image/webp` and `image/avif` and has a 10 MiB object
  limit;
- no broad pre-existing `storage.objects` policy grants access to every bucket.

The migration creates no browser policy for `storage.objects`. The trusted
Worker uploads derivatives with its service-role credential and creates
short-lived signed URLs only after the associated database row has passed the
appropriate public or administrator query.

## 2. Configure Supabase Auth

In **Authentication → Providers → Email**:

1. Keep email authentication enabled.
2. Disable public user creation (**Allow new users to sign up**).
3. Do not enable anonymous sign-ins for wedding guests. Guest upload identity
   is handled by the Worker and does not require a Supabase account.
4. Use passwordless email Magic Links or email OTP for administrators.

In **Authentication → URL Configuration**, add exact redirect URLs for every
admin deployment that will be used. Initially these should include:

```text
http://localhost:4321/moments/admin/
https://seaboiii.github.io/our_journey/moments/admin/
```

Add an exact Cloudflare Pages preview or future Moments-domain admin URL only
when that deployment exists. Prefer exact production paths over broad wildcard
redirects.

The frontend sign-in call should prevent implicit account creation even though
project signup is disabled:

```ts
await supabase.auth.signInWithOtp({
  email,
  options: {
    shouldCreateUser: false,
    emailRedirectTo: adminUrl,
  },
});
```

Display the same neutral “check your email” response whether or not an address
exists. Authorization never relies on the email string or on user-editable
`user_metadata`.

The static admin client uses PKCE. Because an email link may open in a new tab,
the implementation shares only Supabase's exact PKCE verifier/index keys in
`localStorage` for at most 60 minutes and clears them on exchange or expiry.
Access and refresh tokens remain in tab-scoped `sessionStorage`; do not replace
the adapter with blanket local persistence for the whole Auth session.

### Configure production email delivery

Supabase's default SMTP service is only suitable for initial setup. It sends
only to addresses that are members of the Supabase project organization, is
currently limited to two messages per hour, and has no delivery SLA. During the
first local smoke test, make sure the administrator address is a project-team
address and stay within that limit.

Before relying on magic links for the wedding, open the project's
**Authentication → SMTP Settings** and configure a production SMTP provider.
Keep its host, username, and password in Supabase's managed Auth configuration,
never in this repository, Astro variables, or Worker responses. Configure the
provider's sender-domain SPF, DKIM, and DMARC records, then test delivery and
the exact admin redirect from the real administrator mailbox. Review the Auth
email rate limit after enabling custom SMTP; keep it practical for the tiny
admin group rather than making the public form an email relay.

See [Supabase's custom SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp)
for the current default-service restrictions and configuration fields.

## 3. Create the first authorized administrator

Create or invite the owner account from **Authentication → Users**. There is no
public signup screen. Copy the user's UUID from the dashboard, then run the
following in the SQL Editor, replacing only the placeholder:

```sql
insert into public.moment_admins (user_id)
values ('<AUTH_USER_UUID>')
on conflict (user_id) do update
set revoked_at = null;
```

Do not place an email address, password, or real UUID in a migration or frontend
source file. Repeat the statement with a different Auth user UUID only when a
second trusted administrator is required.

To revoke access without deleting the Supabase Auth account:

```sql
update public.moment_admins
set revoked_at = now()
where user_id = '<AUTH_USER_UUID>';
```

Revocation takes effect on the next database request because the RLS policies
see only the caller's own active allowlist row. To restore access, run the first
upsert again.

## 4. Configure keys without crossing trust boundaries

Find the project URL and API keys under **Project Settings → API**.

Browser-safe Astro build values:

```text
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_ANON_KEY
```

These values support Supabase Auth in the static administrator page. The anon
or publishable key is not a secret; RLS is what constrains it.

Supabase currently supports both legacy JWT-shaped keys (`anon` and
`service_role`) and newer opaque keys (`sb_publishable_…` and `sb_secret_…`).
The repository keeps the environment-variable names requested by the Phase 2
contract, but the low-privilege values may be migrated as a pair:

| Environment name | Legacy value | New equivalent |
| --- | --- | --- |
| `PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` | anon key | publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key | secret key |

Always send either kind of API key in the `apikey` header. A genuine signed-in
user access token goes in `Authorization: Bearer <USER_JWT>`. Opaque `sb_…` API
keys are not user JWTs and must not be parsed or authorized as though they were.
If the Worker supports both generations, its request helper should omit the
Authorization header for an opaque API-key-only call; a legacy JWT-shaped key
may continue to be sent as the matching bearer value.

Cloudflare Worker bindings:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_ANON_KEY` is safe but should use a server-style name inside the
Worker. Store `SUPABASE_SERVICE_ROLE_KEY` with `wrangler secret put`; never put
it in an Astro `PUBLIC_` variable, repository file, browser response, log, or
exception.

Use three explicit Supabase request modes in Worker code:

1. anon key for public approved-only reads;
2. anon key plus the caller's bearer token for administrator reads and status
   updates;
3. service role only for trusted metadata insertion, derivative processing,
   Storage upload, and signed-URL creation.

## 5. Map rows to explicit API DTOs

Do not serialize `select *` responses to the frontend. The Worker should select
only the required columns and map snake_case database rows to explicit API
DTOs.

A public Moment response may contain:

```text
id, guestName, caption, createdAt, mediaType,
previewUrl, thumbnailUrl, width, height, status="approved"
```

It must not contain:

```text
drive_file_id, guest_session_id, moderated_by,
gallery_path, thumbnail_path, service credentials
```

Raw Storage paths are input to server-side signed-URL creation, not public DTO
fields. Admin responses may add `processingStatus` and `moderatedAt`, but they
still do not need Drive identifiers, guest session identifiers, or the
moderator's Auth UUID.

Pending, rejected, and hidden derivative previews may be signed only after the
Worker authorizes the administrator. Changing moderation state never deletes
the private Drive original or a derivative object.

### Signed URL lifetime

A private-bucket signed URL remains usable until it expires, even if a moment
is hidden in the meantime. Use a short lifetime such as 10–15 minutes and issue
new URLs on gallery reload. If immediate revocation later becomes mandatory,
replace signed URLs with a carefully cached Worker media endpoint that checks
`approved` and `ready` for every request. Do not solve this by making the bucket
public.

## 6. Run the database tests locally

The SQL test at `supabase/tests/moments_rls.sql` uses pgTAP and rolls all fixture
data back. It checks constraints, public visibility, active and revoked admin
behavior, restricted columns, status-only updates, audit attribution, and the
private bucket.

Prerequisites:

- Docker Desktop or another Docker-compatible runtime;
- the Supabase CLI.

If this repository does not yet have `supabase/config.toml`, initialize local
Supabase once from the repository root:

```sh
npx supabase@latest init
```

Then start the stack, rebuild it from migrations, and run the test:

```sh
npx supabase@latest start
npx supabase@latest db reset
npx supabase@latest test db supabase/tests/moments_rls.sql
npx supabase@latest db lint --local
```

Stop the local services when finished:

```sh
npx supabase@latest stop
```

Normal CI does not need real Google Drive or a hosted Supabase project. The SQL
test creates minimal local `auth.users` fixtures, switches among `anon` and
`authenticated` roles, and runs entirely inside a rollback transaction.

The documented `supabase db reset` step is for the local Docker stack only.
Never add `--linked`, a production database URL, or any remote reset flag to
that command. Confirm that the local stack is running before executing it; use
versioned `db push` migrations for the linked project instead.

## Production verification checklist

- [ ] The migration applied without skipped statements.
- [ ] RLS is enabled on `moments` and `moment_admins`.
- [ ] The derivative bucket is private and has no broad browser policy.
- [ ] Public gallery requests use the anon/publishable key, not service role.
- [ ] Service role exists only as an encrypted Worker secret.
- [ ] Public signup and anonymous Supabase Auth are disabled.
- [ ] Custom SMTP is configured, sender-domain records pass, and a real admin
      magic link has been delivered and opened successfully.
- [ ] Exact localhost and GitHub Pages admin redirect URLs are allowed.
- [ ] The first administrator Auth UUID has an active allowlist row.
- [ ] A valid but unlisted user receives access denied.
- [ ] An approved but still-processing row is absent from the guest gallery.
- [ ] A hidden or rejected moment disappears from new gallery responses while
      its private Google Drive original remains untouched.
