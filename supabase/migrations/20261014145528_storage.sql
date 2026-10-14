-- Private bucket for scale-ticket photos. Uploads and reads go through the
-- server (service role, signed URLs), so the bucket has no RLS policies of
-- its own. Guarded so the migration also applies to the plain-Postgres test
-- harness, which has no storage schema.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('scale-tickets', 'scale-tickets', false, 10485760,
            array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end;
$$;
