-- Storage bucket for durable project thumbnails.
--
-- Run once in the Supabase SQL editor, alongside storage.sql/rls.sql.
-- Idempotent: safe to re-run.
--
-- Unlike the "attachments" bucket, this one is PUBLIC: project cards render
-- these as plain <img> tags across the dashboard for the project's owner on
-- every page load, with no per-request signing — a public bucket serves
-- objects directly via a stable URL, which is what makes the thumbnail
-- durable across refresh/logout/login instead of needing a fresh signed
-- URL (or a live v0 call) every time it's displayed.
--
-- Every write goes through the service-role admin client (see
-- src/lib/services/screenshot.ts / src/lib/supabase/admin.ts), which
-- bypasses RLS entirely — so no INSERT/UPDATE/DELETE policy is needed for
-- normal users to be blocked from writing here; the absence of one already
-- means they can't. Reads don't need a policy either: `public = true` on
-- the bucket serves objects through Storage's public endpoint regardless of
-- RLS on storage.objects.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-thumbnails',
  'project-thumbnails',
  true, -- public: read via a stable URL, no signing needed
  5242880, -- 5 MB
  array['image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
