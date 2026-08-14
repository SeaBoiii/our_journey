-- Wedding Moments metadata, moderation, admin authorization, and derivative
-- storage. Full-quality originals remain private in Google Drive.

create extension if not exists pgcrypto with schema extensions;

create type public.moment_status as enum (
  'pending',
  'approved',
  'rejected',
  'hidden'
);

create type public.moment_media_type as enum (
  'photo',
  'video'
);

create type public.moment_processing_status as enum (
  'pending',
  'ready',
  'failed'
);

create table public.moments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  guest_name text not null,
  caption text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  media_type public.moment_media_type not null,
  mime_type text not null,
  file_name text not null,
  file_size bigint not null,
  -- width/height describe the canonical gallery derivative used by clients.
  width integer,
  height integer,
  -- Drive supplies these output-only original dimensions when its media
  -- metadata is ready. They remain internal and may initially be null.
  original_width integer,
  original_height integer,
  drive_file_id text not null unique,
  gallery_path text unique,
  thumbnail_path text unique,
  status public.moment_status not null default 'pending',
  processing_status public.moment_processing_status not null default 'pending',
  guest_session_id uuid not null,
  moderated_at timestamptz,
  moderated_by uuid references auth.users (id) on delete set null,

  constraint moments_guest_name_length
    check (
      guest_name = btrim(guest_name)
      and char_length(guest_name) between 1 and 80
    ),
  constraint moments_caption_length
    check (char_length(caption) <= 500),
  constraint moments_file_name_length
    check (
      char_length(file_name) between 1 and 255
      and btrim(file_name) <> ''
    ),
  constraint moments_drive_file_id_length
    check (
      drive_file_id = btrim(drive_file_id)
      and char_length(drive_file_id) between 1 and 255
    ),
  constraint moments_dimensions
    check (
      (width is null and height is null)
      or (width > 0 and height > 0)
    ),
  constraint moments_original_dimensions
    check (
      (original_width is null and original_height is null)
      or (original_width > 0 and original_height > 0)
    ),
  constraint moments_file_size
    check (
      (media_type = 'photo' and file_size between 1 and 20971520)
      or
      (media_type = 'video' and file_size between 1 and 157286400)
    ),
  constraint moments_mime_type
    check (
      (
        media_type = 'photo'
        and mime_type in (
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/webp',
          'image/heic',
          'image/heif',
          'image/heic-sequence',
          'image/heif-sequence'
        )
      )
      or
      (
        media_type = 'video'
        and mime_type in ('video/mp4', 'video/quicktime')
      )
    ),
  constraint moments_ready_has_derivatives
    check (
      processing_status <> 'ready'
      or (
        gallery_path is not null
        and thumbnail_path is not null
        and width is not null
        and height is not null
      )
    ),
  constraint moments_gallery_path_is_relative
    check (
      gallery_path is null
      or (
        gallery_path = btrim(gallery_path)
        and char_length(gallery_path) between 1 and 500
        and gallery_path !~ '(^/|://|(^|/)\.\.(/|$))'
        and position(E'\\' in gallery_path) = 0
      )
    ),
  constraint moments_thumbnail_path_is_relative
    check (
      thumbnail_path is null
      or (
        thumbnail_path = btrim(thumbnail_path)
        and char_length(thumbnail_path) between 1 and 500
        and thumbnail_path !~ '(^/|://|(^|/)\.\.(/|$))'
        and position(E'\\' in thumbnail_path) = 0
      )
    )
);

create index moments_gallery_feed_idx
  on public.moments (created_at desc, id desc)
  where status = 'approved' and processing_status = 'ready';

create index moments_moderation_queue_idx
  on public.moments (status, created_at desc, id desc);

create index moments_guest_session_idx
  on public.moments (guest_session_id, created_at desc);

-- This table is a small allowlist keyed by the immutable Supabase Auth user ID.
-- It deliberately stores no password and is not writable from browser roles.
create table public.moment_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,

  constraint moment_admins_revocation_order
    check (revoked_at is null or revoked_at >= created_at)
);

alter table public.moments enable row level security;
alter table public.moment_admins enable row level security;

-- Remove Supabase's broad default table grants, then grant only the columns
-- required by the public gallery and moderation UI. Internal Drive/session
-- fields remain available only to trusted service-role operations.
revoke all on table public.moments from anon, authenticated;
revoke all on table public.moment_admins from anon, authenticated;

grant select (
  id,
  guest_name,
  caption,
  created_at,
  media_type,
  width,
  height,
  gallery_path,
  thumbnail_path,
  status,
  processing_status
) on table public.moments to anon;

grant select (
  id,
  guest_name,
  caption,
  created_at,
  updated_at,
  media_type,
  mime_type,
  file_name,
  file_size,
  width,
  height,
  gallery_path,
  thumbnail_path,
  status,
  processing_status,
  moderated_at
) on table public.moments to authenticated;

grant update (status) on table public.moments to authenticated;
grant select (user_id) on table public.moment_admins to authenticated;

-- An authenticated user can discover only whether their own membership is
-- currently active. Revoked and other administrators' rows stay invisible.
create policy moment_admins_read_active_self
  on public.moment_admins
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and revoked_at is null
  );

-- The Worker's guest-gallery client uses the anon role and can retrieve only
-- media that is approved and ready as a stripped, optimized derivative. A
-- signed-in but unauthorized account gets no direct database fallback.
create policy moments_public_gallery_read
  on public.moments
  for select
  to anon
  using (
    status = 'approved'
    and processing_status = 'ready'
    and gallery_path is not null
    and thumbnail_path is not null
  );

-- The subquery is evaluated through moment_admins' self-only RLS policy. It
-- does not query moments, so the two policies cannot recurse.
create policy moments_admin_read
  on public.moments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.moment_admins as administrator
      where administrator.user_id = (select auth.uid())
    )
  );

create policy moments_admin_update_status
  on public.moments
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.moment_admins as administrator
      where administrator.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.moment_admins as administrator
      where administrator.user_id = (select auth.uid())
    )
    and (
      status <> 'approved'
      or (
        processing_status = 'ready'
        and gallery_path is not null
        and thumbnail_path is not null
        and gallery_path = thumbnail_path
        and width is not null
        and width > 0
        and height is not null
        and height > 0
      )
    )
  );

-- Browser roles can update only the status column. The trigger owns the
-- timestamps and actor identity so an administrator cannot forge audit data.
create function public.set_moment_audit_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();

  if new.status is distinct from old.status then
    new.moderated_at := now();
    new.moderated_by := auth.uid();
  end if;

  return new;
end;
$$;

revoke execute on function public.set_moment_audit_fields()
  from public, anon, authenticated;

create trigger moments_set_audit_fields
before update on public.moments
for each row
execute function public.set_moment_audit_fields();

-- Only public-display derivatives belong here. The bucket is private and this
-- migration intentionally creates no anon/authenticated storage.objects
-- policies. The Worker uploads derivatives and creates short-lived signed URLs
-- with its service-role credential.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'moments-gallery',
  'moments-gallery',
  false,
  10485760,
  array['image/webp', 'image/avif']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
