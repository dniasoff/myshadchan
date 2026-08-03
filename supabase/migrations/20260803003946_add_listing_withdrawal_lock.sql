drop policy "Single listings insert" on "public"."listings";


  create table "public"."listing_withdrawal_locks" (
    "single_id" bigint not null,
    "account_id" bigint not null,
    "locked_at" timestamp with time zone not null default now()
      );


alter table "public"."listing_withdrawal_locks" enable row level security;

-- `db diff` never re-emits FORCE ROW LEVEL SECURITY (AGENTS.md's own
-- warning) — hand-added so postgres/supabase_admin's BYPASSRLS is the only
-- thing standing between this table and RLS, matching every other Epic 9
-- table (AD-1).
alter table "public"."listing_withdrawal_locks" force row level security;

CREATE INDEX listing_withdrawal_locks_account_id_idx ON public.listing_withdrawal_locks USING btree (account_id);

CREATE UNIQUE INDEX listing_withdrawal_locks_pkey ON public.listing_withdrawal_locks USING btree (single_id);

alter table "public"."listing_withdrawal_locks" add constraint "listing_withdrawal_locks_pkey" PRIMARY KEY using index "listing_withdrawal_locks_pkey";

alter table "public"."listing_withdrawal_locks" add constraint "listing_withdrawal_locks_single_id_fkey" FOREIGN KEY (account_id, single_id) REFERENCES public.singles(account_id, id) ON DELETE CASCADE not valid;

alter table "public"."listing_withdrawal_locks" validate constraint "listing_withdrawal_locks_single_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.consent_to_republish_listing(p_single_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from public.listing_withdrawal_locks ll
    where ll.account_id = public.current_context_id()
      and ll.single_id = p_single_id
      and exists (
        select 1
        from public.account_members am
          join public.singles s on s.member_id = am.id
        where am.account_id = public.current_context_id()
          and am.user_id = auth.uid()
          and am.role in ('single', 'self_manager')
          and s.id = ll.single_id
      );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lock_listing_on_single_withdrawal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.listing_type = 'single' then
    if exists (
      select 1
      from public.account_members am
        join public.singles s on s.member_id = am.id
      where am.account_id = old.account_id
        and am.user_id = auth.uid()
        and am.role = 'single'
        and s.id = old.single_id
    ) then
      insert into public.listing_withdrawal_locks (account_id, single_id)
        values (old.account_id, old.single_id)
        on conflict (single_id) do nothing;
    end if;
  end if;
  return old;
end;
$function$
;

-- Hand-added — `db diff` never re-emits function grants either (AGENTS.md).
-- `consent_to_republish_listing` is never anon-reachable (AC-4's own
-- required check); matches create_shidduch()'s own grant triplet shape.
revoke all on function public.consent_to_republish_listing(bigint) from public, anon;
grant execute on function public.consent_to_republish_listing(bigint) to authenticated;
grant execute on function public.consent_to_republish_listing(bigint) to service_role;

-- `db diff` diffs the DECLARED schema (a fresh, isolated build of
-- 01-07_*.sql) against the CURRENT database, and in that fresh build
-- `06_grants.sql`'s own `alter default privileges ... grant all on tables
-- to authenticated` — physically declared AFTER `01_tables.sql` creates
-- this table — never touches it, so migra sees this table's "declared"
-- authenticated ACL as select-only from the schema file's own explicit
-- grant alone and considers the diff complete. But on the REAL database,
-- that same default-privileges statement was executed years ago (an
-- early, fork-era migration) and is standing, persistent catalog state —
-- so THIS migration's own `CREATE TABLE` above will silently auto-grant
-- `authenticated` (and, per that block's revoke-from-anon default,
-- nothing to `anon`) full DML the instant it runs, exactly the F1 finding
-- Story 9.1's own migration hit for `listings`. Hand-added, matching that
-- precedent precisely (revoke first, THEN grant back only what AC-4
-- intends) — omitting this would leave `authenticated` holding
-- insert/update/delete/truncate/references/trigger on a table whose
-- entire security model is "no DML grant exists at all".
revoke all on table "public"."listing_withdrawal_locks" from "anon";
revoke all on table "public"."listing_withdrawal_locks" from "authenticated";

grant select on table "public"."listing_withdrawal_locks" to "authenticated";

grant delete on table "public"."listing_withdrawal_locks" to "service_role";

grant insert on table "public"."listing_withdrawal_locks" to "service_role";

grant references on table "public"."listing_withdrawal_locks" to "service_role";

grant select on table "public"."listing_withdrawal_locks" to "service_role";

grant trigger on table "public"."listing_withdrawal_locks" to "service_role";

grant truncate on table "public"."listing_withdrawal_locks" to "service_role";

grant update on table "public"."listing_withdrawal_locks" to "service_role";


  create policy "Listing locks readable in account"
  on "public"."listing_withdrawal_locks"
  as permissive
  for select
  to authenticated
using ((account_id = public.current_context_id()));



  create policy "Single listings delete"
  on "public"."listings"
  as permissive
  for delete
  to authenticated
using (((listing_type = 'single'::text) AND (account_id = public.current_context_id()) AND ((EXISTS ( SELECT 1
   FROM public.account_members am
  WHERE ((am.account_id = public.current_context_id()) AND (am.user_id = auth.uid()) AND (am.role = 'parent_admin'::text)))) OR (EXISTS ( SELECT 1
   FROM (public.account_members am
     JOIN public.singles s ON ((s.member_id = am.id)))
  WHERE ((am.account_id = public.current_context_id()) AND (am.user_id = auth.uid()) AND (am.role = ANY (ARRAY['single'::text, 'self_manager'::text])) AND (s.id = listings.single_id)))))));



  create policy "Single listings insert"
  on "public"."listings"
  as permissive
  for insert
  to authenticated
with check (((listing_type = 'single'::text) AND (account_id = public.current_context_id()) AND (single_id IN ( SELECT s.id
   FROM public.singles s
  WHERE (s.account_id = public.current_context_id()))) AND (EXISTS ( SELECT 1
   FROM public.accounts a
  WHERE ((a.id = public.current_context_id()) AND (a.kind = 'household'::text)))) AND ((EXISTS ( SELECT 1
   FROM public.account_members am
  WHERE ((am.account_id = public.current_context_id()) AND (am.user_id = auth.uid()) AND (am.role = 'parent_admin'::text)))) OR (EXISTS ( SELECT 1
   FROM (public.account_members am
     JOIN public.singles s ON ((s.member_id = am.id)))
  WHERE ((am.account_id = public.current_context_id()) AND (am.user_id = auth.uid()) AND (am.role = 'self_manager'::text) AND (s.id = listings.single_id))))) AND (NOT (EXISTS ( SELECT 1
   FROM public.listing_withdrawal_locks ll
  WHERE ((ll.account_id = public.current_context_id()) AND (ll.single_id = listings.single_id)))))));


CREATE TRIGGER lock_listing_on_single_withdrawal AFTER DELETE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.lock_listing_on_single_withdrawal();


