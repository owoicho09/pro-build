-- Storage bucket + policies for project attachments (Slice 4).
--
-- Run once in the Supabase SQL editor, alongside seed.sql/rls.sql. Storage
-- buckets and their access policies live in Postgres too (the `storage`
-- schema), so this is plain SQL like the rest — no separate dashboard step
-- needed.
--
-- Idempotent: safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false, -- private: every read goes through a signed URL we generate server-side
  20971520, -- 20 MB
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/markdown', 'text/csv'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Objects are stored at `<owner_id>/<project_id>/<uuid>-<filename>` — the
-- first path segment is the owner, so policies scope on that.

drop policy if exists "attachments_storage_insert_own" on storage.objects;
create policy "attachments_storage_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "attachments_storage_select_own" on storage.objects;
create policy "attachments_storage_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "attachments_storage_delete_own" on storage.objects;
create policy "attachments_storage_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
