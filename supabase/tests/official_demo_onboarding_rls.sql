-- Official onboarding demo retry tables: no browser table access, while the
-- caller-scoped onboarding RPCs remain usable by an authenticated first-run
-- caller.  Everything runs in one transaction and is rolled back.
\set ON_ERROR_STOP on
begin;

create temp table results (
  name text not null,
  passed boolean not null,
  detail text
);

insert into auth.users (id, instance_id, aud, role, email)
values (
  '91500000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'demo-onboarding-rls@test.local'
);
insert into auth.users (id, instance_id, aud, role, email)
values (
  '91500000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'demo-onboarding-race@test.local'
);

insert into results (name, passed, detail)
select 'demo_run_auth_cleanup is RLS protected for browser roles',
       c.relrowsecurity and c.relforcerowsecurity,
       'relrowsecurity/relforcerowsecurity'
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'demo_run_auth_cleanup';

insert into results (name, passed, detail)
select 'demo_onboarding_intents is RLS protected for browser roles',
       c.relrowsecurity and c.relforcerowsecurity,
       'relrowsecurity/relforcerowsecurity'
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'demo_onboarding_intents';

insert into results (name, passed, detail)
select format('%s has no direct browser table privileges', table_name),
       not has_table_privilege(role_name, format('public.%s', table_name), privilege),
       format('%s/%s', role_name, privilege)
from (
  values
    ('anon'::name), ('authenticated'::name)
) as roles(role_name)
cross join (
  values
    ('demo_run_auth_cleanup'::text), ('demo_onboarding_intents'::text)
) as tables(table_name)
cross join (
  values
    ('select'::text), ('insert'::text), ('update'::text), ('delete'::text)
) as privileges(privilege);

insert into results (name, passed, detail)
select format('%s cannot execute link_demo_onboarding_intent directly', role_name),
       not has_function_privilege(
         role_name,
         'public.link_demo_onboarding_intent(uuid,bigint,boolean)',
         'execute'
       ),
       role_name::text
from (values ('public'::name), ('anon'::name), ('authenticated'::name)) as roles(role_name);

-- Catalog privilege checks above are supplemented with live attempts. A
-- future policy/grant change must not turn either browser role's read or
-- write path into a silent success.
set local role anon;
do $$
declare
  table_name text;
  operation text;
  statement text;
begin
  for table_name in select unnest(array['demo_run_auth_cleanup', 'demo_onboarding_intents']) loop
    for operation in select unnest(array['select', 'insert', 'update', 'delete']) loop
      statement := case operation
        when 'select' then format('select 1 from public.%I limit 1', table_name)
        when 'insert' then format('insert into public.%I default values', table_name)
        when 'update' then format('update public.%I set updated_at = updated_at where false', table_name)
        else format('delete from public.%I where false', table_name)
      end;
      begin
        execute statement;
        raise exception 'anon unexpectedly completed % on %', operation, table_name;
      exception when insufficient_privilege then
        null;
      end;
    end loop;
  end loop;
end;
$$;
reset role;

set local role authenticated;
do $$
declare
  table_name text;
  operation text;
  statement text;
begin
  for table_name in select unnest(array['demo_run_auth_cleanup', 'demo_onboarding_intents']) loop
    for operation in select unnest(array['select', 'insert', 'update', 'delete']) loop
      statement := case operation
        when 'select' then format('select 1 from public.%I limit 1', table_name)
        when 'insert' then format('insert into public.%I default values', table_name)
        when 'update' then format('update public.%I set updated_at = updated_at where false', table_name)
        else format('delete from public.%I where false', table_name)
      end;
      begin
        execute statement;
        raise exception 'authenticated unexpectedly completed % on %', operation, table_name;
      exception when insufficient_privilege then
        null;
      end;
    end loop;
  end loop;
end;
$$;
reset role;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"91500000-0000-0000-0000-000000000001","role":"authenticated"}';

select public.prepare_demo_onboarding() ->> 'state' as prepared_state \gset
select state as observed_state, account_id as observed_account_id, attempts as observed_attempts
from public.get_demo_onboarding_state()
\gset
select public.cancel_demo_onboarding();

reset role;
set local request.jwt.claims = '{}';

insert into results (name, passed, detail)
values
  ('authenticated caller can prepare a pending demo intent',
    :'prepared_state' = 'pending', :'prepared_state'),
  ('authenticated caller can read its own onboarding intent',
    :'observed_state' = 'pending' and :'observed_attempts'::integer = 1,
    :'observed_state'),
  ('authenticated caller can cancel its own onboarding intent',
    not exists (
      select 1 from public.demo_onboarding_intents
      where user_id = '91500000-0000-0000-0000-000000000001'
    ),
    'intent removed');

-- A caller may prepare the intent and acquire an existing parent-admin
-- context before add_persona runs. That context is not a household created by
-- this add_persona transaction, so it must not become the demo target.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"91500000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.prepare_demo_onboarding() ->> 'state' as race_prepared_state \gset
reset role;
set local request.jwt.claims = '{}';

insert into public.accounts (name, kind, demo)
values ('Existing Race Household', 'household', false)
returning id as race_account_id \gset
insert into public.account_members (account_id, user_id, role, status)
values (:race_account_id, '91500000-0000-0000-0000-000000000002', 'parent_admin', 'active');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"91500000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  begin
    perform public.add_persona('parent');
    raise exception 'existing parent context unexpectedly linked an unlinked intent';
  exception when check_violation then
    null;
  end;
end;
$$;
reset role;
set local request.jwt.claims = '{}';

insert into results (name, passed, detail)
values
  ('race caller can prepare an intent before context acquisition',
    :'race_prepared_state' = 'pending', :'race_prepared_state'),
  ('existing parent context cannot claim an unlinked demo intent',
    (select account_id is null from public.demo_onboarding_intents
     where user_id = '91500000-0000-0000-0000-000000000002'),
    'intent remains unlinked');

-- Browser roles cannot invoke the internal linking helper even though the
-- SECURITY DEFINER add_persona path can call it internally.
set local role anon;
do $$
begin
  begin
    perform public.link_demo_onboarding_intent(
      '91500000-0000-0000-0000-000000000001', 1, false
    );
    raise exception 'anon unexpectedly executed link_demo_onboarding_intent';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"91500000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  begin
    perform public.link_demo_onboarding_intent(
      '91500000-0000-0000-0000-000000000001', 1, false
    );
    raise exception 'authenticated unexpectedly executed link_demo_onboarding_intent';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
set local request.jwt.claims = '{}';

-- Releasing the demo must leave a true first-run state. The completed intent
-- is removed in the same finalizer transaction, so the same caller can
-- prepare and provision a fresh family immediately afterward.
insert into public.accounts (name, kind, demo)
values ('Demo Release Household', 'household', true)
returning id as release_account_id \gset
insert into public.account_members (account_id, user_id, role, status)
values (:release_account_id, '91500000-0000-0000-0000-000000000001', 'parent_admin', 'active');
insert into public.member_state (user_id, active_account_id, updated_at)
values ('91500000-0000-0000-0000-000000000001', :release_account_id, now())
on conflict (user_id) do update set active_account_id = excluded.active_account_id;
insert into public.demo_runs (
  root_account_id, status, lease_expires_at, lease_token, operation, original_root_name
)
values (
  :release_account_id, 'clearing', now() + interval '1 hour',
  'release-demo-token', 'clear', 'Original Release Household'
)
returning id as release_run_id \gset
insert into public.demo_run_accounts (run_id, account_id, context_key, context_kind, is_root)
values (:release_run_id, :release_account_id, 'primary-household', 'household', true);
insert into public.demo_run_member_state (run_id, user_id, original_active_account_id, original_updated_at)
values (:release_run_id, '91500000-0000-0000-0000-000000000001', :release_account_id, now());
insert into public.demo_onboarding_intents (user_id, account_id, state, demo_run_id, attempts)
values ('91500000-0000-0000-0000-000000000001', :release_account_id, 'completed', :release_run_id, 1);

select public.finalize_demo_clear(
  :release_run_id, 'release-demo-token', true, true,
  '91500000-0000-0000-0000-000000000001'
);

insert into results (name, passed, detail)
values
  ('release finalizer clears the completed onboarding intent atomically',
    not exists (
      select 1 from public.demo_onboarding_intents
      where user_id = '91500000-0000-0000-0000-000000000001'
    ), 'completed intent removed'),
  ('release finalizer never restores an archived bootstrap membership',
    (select active_account_id is null from public.member_state
     where user_id = '91500000-0000-0000-0000-000000000001')
    and exists (
      select 1 from public.account_members
      where account_id = :release_account_id
        and user_id = '91500000-0000-0000-0000-000000000001'
        and status = 'archived'
    ), 'active pointer is null and bootstrap membership is archived');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"91500000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.prepare_demo_onboarding() ->> 'state' as reprepare_state \gset
select public.add_persona('parent');
reset role;
set local request.jwt.claims = '{}';

insert into results (name, passed, detail)
values
  ('released caller can prepare onboarding again',
    :'reprepare_state' = 'pending', :'reprepare_state'),
  ('released caller links a new parent account to the new intent',
    exists (
      select 1 from public.demo_onboarding_intents
      where user_id = '91500000-0000-0000-0000-000000000001'
        and state = 'pending'
        and account_id is not null
        and account_id <> :release_account_id
    ), 'new account linked');

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
