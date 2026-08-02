revoke select on table "public"."listings" from "anon";

revoke references on table "public"."listings" from "authenticated";

revoke trigger on table "public"."listings" from "authenticated";

revoke truncate on table "public"."listings" from "authenticated";

-- Story 9.1 review finding F1: the four revokes above (`db diff`-generated)
-- strip everything the fork's default privileges had attached to
-- `authenticated` beyond select/insert/update/delete — most importantly
-- TRUNCATE, which BYPASSES ROW LEVEL SECURITY. `06_grants.sql` now names
-- `authenticated` in the same `revoke all` as `anon`, matching the
-- "TRUNCATE/MAINTAIN hardening" idiom every other table in that file already
-- uses.

-- Story 9.1 review finding F6: `anon`'s SELECT is re-granted as an
-- enumerated column list rather than the whole table. `db diff` does not
-- emit column-level grants (AGENTS.md), so this is hand-added to match
-- `supabase/schemas/06_grants.sql`. `account_id`, `single_id` and
-- `published_by_member_id` are internal tenant/member identifiers, never
-- opted-in listing content (FR101 promises "name, area, how to reach"), and
-- are deliberately absent — otherwise `?account_id=eq.N` /
-- `?order=account_id.desc` would let an anonymous caller enumerate or link
-- records by internal primary key.
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
  ) on table "public"."listings" to "anon";

-- Story 9.1 review finding F4: `db diff` never emits sequence grants either,
-- and a `generated ... as identity` column's own sequence does not inherit
-- the ACL a plain `create sequence` gets from the schema's default
-- privileges. These three statements were declared in `06_grants.sql` from
-- `listings`' very first migration but never reached the database until
-- now — functionally harmless (identity columns don't consult the sequence
-- ACL to generate a value, and `anon` already held nothing on it), but a
-- schema file asserting state the database does not have is exactly the
-- drift `db diff` cannot catch on its own.
revoke all on sequence "public"."listings_id_seq" from "anon";

grant usage, select on sequence "public"."listings_id_seq" to "authenticated";

grant all on sequence "public"."listings_id_seq" to "service_role";
