-- Reconcile the declarative public-listing boundary with the migration
-- history. The original listings migration granted anon table-level SELECT;
-- the public marketplace contract is column-level only, so tenant and subject
-- identifiers must not be queryable by anonymous clients.

revoke all on table public.listings from anon, authenticated;

grant select (
  id,
  created_at,
  listing_type,
  shadchan_name,
  shadchan_area,
  shadchan_contact_info,
  single_first_name_en,
  single_first_name_he,
  single_age,
  single_height,
  single_community,
  single_location,
  single_summary
) on table public.listings to anon;

grant select, insert, update, delete on table public.listings to authenticated;
grant all on table public.listings to service_role;

revoke all on sequence public.listings_id_seq from anon;
grant usage, select on sequence public.listings_id_seq to authenticated;
grant all on sequence public.listings_id_seq to service_role;
