begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

select has_table(
  'public',
  'moments',
  'moments metadata table exists'
);

select has_table(
  'public',
  'moment_admins',
  'moment administrator allowlist exists'
);

select has_column(
  'public',
  'moments',
  'processing_status',
  'moments keep processing state separate from moderation state'
);

select results_eq(
  $$
    select public
    from storage.buckets
    where id = 'moments-gallery'
  $$,
  array[false],
  'the derivative bucket is private'
);

-- Constraint tests run as the migration owner so failures demonstrate database
-- validation rather than browser-role permission failures.
select throws_matching(
  $$
    insert into public.moments (
      id, submission_id, guest_name, media_type, mime_type, file_name,
      file_size, drive_file_id, guest_session_id
    ) values (
      '90000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '   ', 'photo', 'image/jpeg', 'invalid-name.jpg', 1024,
      'invalid-name-drive-id',
      '92000000-0000-4000-8000-000000000001'
    )
  $$,
  '.*moments_guest_name_length.*',
  'whitespace-only guest names are rejected'
);

select throws_matching(
  $$
    insert into public.moments (
      id, submission_id, guest_name, caption, media_type, mime_type,
      file_name, file_size, drive_file_id, guest_session_id
    ) values (
      '90000000-0000-4000-8000-000000000002',
      '91000000-0000-4000-8000-000000000002',
      'Guest', repeat('x', 501), 'photo', 'image/jpeg',
      'long-caption.jpg', 1024, 'long-caption-drive-id',
      '92000000-0000-4000-8000-000000000002'
    )
  $$,
  '.*moments_caption_length.*',
  'captions longer than 500 characters are rejected'
);

select throws_matching(
  $$
    insert into public.moments (
      id, submission_id, guest_name, media_type, mime_type, file_name,
      file_size, drive_file_id, guest_session_id
    ) values (
      '90000000-0000-4000-8000-000000000003',
      '91000000-0000-4000-8000-000000000003',
      'Guest', 'photo', 'video/mp4', 'mismatch.mp4', 1024,
      'mime-mismatch-drive-id',
      '92000000-0000-4000-8000-000000000003'
    )
  $$,
  '.*moments_mime_type.*',
  'MIME types must match their media type'
);

select throws_matching(
  $$
    insert into public.moments (
      id, submission_id, guest_name, media_type, mime_type, file_name,
      file_size, drive_file_id, guest_session_id
    ) values (
      '90000000-0000-4000-8000-000000000004',
      '91000000-0000-4000-8000-000000000004',
      'Guest', 'photo', 'image/jpeg', 'too-large.jpg', 20971521,
      'too-large-drive-id',
      '92000000-0000-4000-8000-000000000004'
    )
  $$,
  '.*moments_file_size.*',
  'photos over 20 MiB are rejected'
);

select throws_matching(
  $$
    insert into public.moments (
      id, submission_id, guest_name, media_type, mime_type, file_name,
      file_size, width, height, drive_file_id, processing_status,
      guest_session_id
    ) values (
      '90000000-0000-4000-8000-000000000005',
      '91000000-0000-4000-8000-000000000005',
      'Guest', 'photo', 'image/jpeg', 'not-derived.jpg', 1024, 100, 100,
      'not-derived-drive-id', 'ready',
      '92000000-0000-4000-8000-000000000005'
    )
  $$,
  '.*moments_ready_has_derivatives.*',
  'ready media requires both derivative paths and dimensions'
);

select throws_matching(
  $$
    insert into public.moments (
      id, submission_id, guest_name, media_type, mime_type, file_name,
      file_size, drive_file_id, guest_session_id, original_width
    ) values (
      '90000000-0000-4000-8000-000000000007',
      '91000000-0000-4000-8000-000000000007',
      'Guest', 'photo', 'image/jpeg', 'half-dimension.jpg', 1024,
      'half-dimension-drive-id',
      '92000000-0000-4000-8000-000000000007', 4032
    )
  $$,
  '.*moments_original_dimensions.*',
  'original dimensions must be a positive width and height pair'
);

-- Supabase's documented SQL-test fixture form is sufficient for auth.users;
-- password and identity records are irrelevant to database RLS evaluation.
insert into auth.users (id, email) values
  (
    '20000000-0000-4000-8000-000000000001',
    'active-admin@example.test'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'ordinary-user@example.test'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'revoked-admin@example.test'
  );

insert into public.moment_admins (user_id, created_at, revoked_at) values
  (
    '20000000-0000-4000-8000-000000000001',
    '2020-01-01T00:00:00Z',
    null
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '2020-01-01T00:00:00Z',
    '2020-01-02T00:00:00Z'
  );

insert into public.moments (
  id,
  submission_id,
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
  drive_file_id,
  gallery_path,
  thumbnail_path,
  status,
  processing_status,
  guest_session_id
) values
  (
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'Approved Guest',
    'Approved and ready',
    '2026-08-14T00:01:00Z',
    '2026-08-14T00:01:00Z',
    'photo', 'image/jpeg', 'approved.jpg', 1024, 1200, 800,
    'drive-approved',
    '10000000-0000-4000-8000-000000000001/gallery.webp',
    '10000000-0000-4000-8000-000000000001/thumbnail.webp',
    'approved', 'ready',
    '40000000-0000-4000-8000-000000000001'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001',
    'Pending Guest',
    'Pending and ready',
    '2026-08-14T00:02:00Z',
    '2026-08-14T00:02:00Z',
    'photo', 'image/jpeg', 'pending.jpg', 1024, 800, 1200,
    'drive-pending',
    '10000000-0000-4000-8000-000000000002/gallery.webp',
    '10000000-0000-4000-8000-000000000002/thumbnail.webp',
    'pending', 'ready',
    '40000000-0000-4000-8000-000000000002'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000002',
    'Rejected Guest',
    'Rejected and ready',
    '2026-08-14T00:03:00Z',
    '2026-08-14T00:03:00Z',
    'photo', 'image/jpeg', 'rejected.jpg', 1024, 1200, 800,
    'drive-rejected',
    '10000000-0000-4000-8000-000000000003/gallery.webp',
    '10000000-0000-4000-8000-000000000003/thumbnail.webp',
    'rejected', 'ready',
    '40000000-0000-4000-8000-000000000003'
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    '30000000-0000-4000-8000-000000000002',
    'Hidden Guest',
    'Hidden and ready',
    '2026-08-14T00:04:00Z',
    '2026-08-14T00:04:00Z',
    'photo', 'image/jpeg', 'hidden.jpg', 1024, 800, 1200,
    'drive-hidden',
    '10000000-0000-4000-8000-000000000004/gallery.webp',
    '10000000-0000-4000-8000-000000000004/thumbnail.webp',
    'hidden', 'ready',
    '40000000-0000-4000-8000-000000000004'
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000003',
    'Processing Guest',
    'Approved but still processing',
    '2026-08-14T00:05:00Z',
    '2026-08-14T00:05:00Z',
    'photo', 'image/heic', 'processing.heic', 1024, 1200, 800,
    'drive-processing', null, null,
    'approved', 'pending',
    '40000000-0000-4000-8000-000000000005'
  ),
  (
    '10000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000004',
    'Unprocessed Guest',
    'Pending without a safe preview',
    '2026-08-14T00:06:00Z',
    '2026-08-14T00:06:00Z',
    'photo', 'image/heic', 'unprocessed.heic', 1024, null, null,
    'drive-unprocessed', null, null,
    'pending', 'pending',
    '40000000-0000-4000-8000-000000000006'
  );

set local role anon;

select results_eq(
  'select count(id) from public.moments',
  array[1::bigint],
  'anonymous callers see only approved and ready moments'
);

select throws_matching(
  'select drive_file_id from public.moments',
  '.*permission denied.*moments.*',
  'anonymous callers cannot select internal Drive identifiers'
);

select throws_matching(
  $$
    insert into public.moments (
      id, submission_id, guest_name, media_type, mime_type, file_name,
      file_size, drive_file_id, guest_session_id
    ) values (
      '90000000-0000-4000-8000-000000000006',
      '91000000-0000-4000-8000-000000000006',
      'Anonymous Guest', 'photo', 'image/jpeg', 'anonymous.jpg', 1024,
      'anonymous-drive-id',
      '92000000-0000-4000-8000-000000000006'
    )
  $$,
  '.*(permission denied.*moments|row-level security).*',
  'anonymous callers cannot insert metadata directly'
);

reset role;
set local request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
set local role authenticated;

select results_eq(
  'select count(id) from public.moments',
  array[0::bigint],
  'authenticated non-admins receive no direct database rows'
);

select results_eq(
  $$
    with changed as (
      update public.moments
      set status = 'hidden'
      where id = '10000000-0000-4000-8000-000000000001'
      returning id
    )
    select count(*) from changed
  $$,
  array[0::bigint],
  'authenticated non-admins cannot moderate public rows'
);

reset role;
set local request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';
set local role authenticated;

select results_eq(
  'select count(id) from public.moments',
  array[6::bigint],
  'an active administrator can read every moderation status'
);

select throws_matching(
  $$
    update public.moments
    set status = 'approved'
    where id = '10000000-0000-4000-8000-000000000006'
  $$,
  '.*row-level security.*moments.*',
  'an administrator cannot approve media before its canonical preview is ready'
);

select throws_matching(
  'select drive_file_id from public.moments',
  '.*permission denied.*moments.*',
  'an administrator still cannot select internal Drive identifiers'
);

select lives_ok(
  $$
    update public.moments
    set status = 'hidden'
    where id = '10000000-0000-4000-8000-000000000003'
  $$,
  'an active administrator can change a moderation status'
);

reset role;

select ok(
  (
    select
      status = 'hidden'
      and moderated_at is not null
      and moderated_by = '20000000-0000-4000-8000-000000000001'::uuid
      and updated_at > '2026-08-14T00:03:00Z'::timestamptz
    from public.moments
    where id = '10000000-0000-4000-8000-000000000003'
  ),
  'the moderation trigger owns timestamps and the actor identity'
);

set local request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';
set local role authenticated;

select throws_matching(
  $$
    update public.moments
    set caption = 'Forged metadata'
    where id = '10000000-0000-4000-8000-000000000001'
  $$,
  '.*permission denied.*moments.*',
  'administrators cannot edit guest metadata'
);

select throws_matching(
  $$
    delete from public.moments
    where id = '10000000-0000-4000-8000-000000000001'
  $$,
  '.*permission denied.*moments.*',
  'administrators cannot permanently delete moments'
);

reset role;
set local request.jwt.claim.sub = '20000000-0000-4000-8000-000000000003';
set local role authenticated;

select results_eq(
  'select count(id) from public.moments',
  array[0::bigint],
  'a revoked administrator immediately loses direct database reads'
);

select results_eq(
  $$
    with changed as (
      update public.moments
      set status = 'hidden'
      where id = '10000000-0000-4000-8000-000000000001'
      returning id
    )
    select count(*) from changed
  $$,
  array[0::bigint],
  'a revoked administrator cannot moderate moments'
);

reset role;

select * from finish();
rollback;
