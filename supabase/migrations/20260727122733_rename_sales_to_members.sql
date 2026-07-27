-- Rename the sales table (and every object attached to it) to members.
--
-- `supabase db diff` renders a table rename as DROP TABLE + CREATE TABLE,
-- which would delete every existing profile row. This migration is hand-
-- written as an explicit ALTER ... RENAME sequence instead, so existing
-- rows, grants, RLS policies and dependent-object OIDs all survive the
-- rename untouched (a table rename carries its grants and policies with it
-- automatically; it does NOT rename its identity sequence, primary-key
-- constraint or indexes, so those get their own ALTER statements below).

alter table public.sales rename to members;

alter table public.members rename constraint sales_pkey to members_pkey;

alter table public.members rename constraint sales_user_id_fkey to members_user_id_fkey;

alter index public.uq__sales__user_id rename to uq__members__user_id;

alter sequence public.sales_id_seq rename to members_id_seq;

alter table public.tasks rename column sales_id to member_id;

comment on column public.tasks.member_id is 'FK-less reference to public.members(id) — the assignee/reminder-owner user. NOT public.account_members, unlike other *_member_id columns in this schema.';

-- ALTER FUNCTION ... RENAME preserves the function's OID, so the trigger
-- below keeps pointing at the same function through the rename. Rename the
-- function first, replace its body, then rename the trigger.
alter function public.set_sales_id_default() rename to set_member_id_default;

alter trigger set_task_sales_id_trigger on public.tasks rename to set_task_member_id_trigger;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION "public"."set_member_id_default"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.member_id IS NULL THEN
    SELECT id INTO NEW.member_id FROM members WHERE user_id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  member_count int;
  v_account_id bigint;
begin
  select count(id) into member_count
  from public.members;

  insert into public.members (first_name, last_name, email, user_id, administrator)
  values (
    coalesce(
      nullif(new.raw_user_meta_data ->> 'first_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', ''),
      nullif(new.raw_user_meta_data ->> 'given_name', ''),
      nullif(split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ' ', 1), ''),
      'Pending'),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'last_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', ''),
      nullif(new.raw_user_meta_data ->> 'family_name', ''),
      case when position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')) > 0
           then substr(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')) + 1)
      end,
      'Pending'),
    new.email,
    new.id,
    case when member_count > 0 then FALSE else TRUE end
  );

  if not exists (select 1 from public.account_members) then
    select a.id into v_account_id
    from public.accounts a
    order by a.id
    limit 1;

    if v_account_id is null then
      insert into public.accounts (name) values ('My Account')
      returning id into v_account_id;
    end if;

    insert into public.account_members (account_id, user_id, role, status)
    values (v_account_id, new.id, 'parent_admin', 'active');
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_update_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.members
  set
    first_name = coalesce(
      nullif(new.raw_user_meta_data ->> 'first_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', ''),
      nullif(new.raw_user_meta_data ->> 'given_name', ''),
      nullif(split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ' ', 1), ''),
      'Pending'),
    last_name = coalesce(
      nullif(new.raw_user_meta_data ->> 'last_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', ''),
      nullif(new.raw_user_meta_data ->> 'family_name', ''),
      case when position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')) > 0
           then substr(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')) + 1)
      end,
      'Pending'),
    email = new.email
  where user_id = new.id;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return exists (
    select 1 from public.members where user_id = auth.uid() and administrator = true
  );
end;
$$;

-- init_state's security_invoker = off posture (a definer-style view
-- deliberately readable by anon pre-sign-in) must be re-declared byte-for-
-- byte — `db diff` does not carry it forward automatically.
create or replace view public.init_state with (security_invoker = off) as
select count(sub.id) as is_initialized
from (
    select members.id from public.members limit 1
) sub;
