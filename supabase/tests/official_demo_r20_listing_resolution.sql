-- r20 listing seed-resolution proof. Every mutation is inside one transaction
-- and the final rollback restores Stack 2 exactly as it was.
\set ON_ERROR_STOP on
begin;

create temp table results (
  name text not null,
  passed boolean not null,
  detail text
) on commit drop;
grant all on results to public;

create function pg_temp.check_denied(
  p_name text,
  p_sql text,
  p_expected_state text,
  p_expected_message_like text default '%'
) returns void language plpgsql as $$
begin
  execute p_sql;
  insert into results values (p_name, false, 'statement unexpectedly succeeded');
exception when others then
  insert into results values (
    p_name,
    sqlstate = p_expected_state and sqlerrm like p_expected_message_like,
    format('sqlstate %s %L (expected %s matching %L)', sqlstate, sqlerrm,
      p_expected_state, p_expected_message_like)
  );
end;
$$;

create function pg_temp.check_resolver_denied(
  p_name text,
  p_sql text,
  p_expected_state text,
  p_expected_message_like text default '%'
) returns void language plpgsql as $$
declare
  v_before bigint;
  v_after bigint;
begin
  select count(*) into v_before
  from public.demo_run_resources
  where run_id = current_setting('official_demo.r20_run_id')::bigint
    and resource_type = 'listing';
  begin
    execute p_sql;
    insert into results values (p_name, false, 'statement unexpectedly succeeded');
  exception when others then
    insert into results values (
      p_name,
      sqlstate = p_expected_state and sqlerrm like p_expected_message_like,
      format('sqlstate %s %L (expected %s matching %L)', sqlstate, sqlerrm,
        p_expected_state, p_expected_message_like)
    );
  end;
  select count(*) into v_after
  from public.demo_run_resources
  where run_id = current_setting('official_demo.r20_run_id')::bigint
    and resource_type = 'listing';
  if v_after <> v_before then
    update results
    set passed = false,
        detail = coalesce(detail, '') || format('; manifest changed %s -> %s', v_before, v_after)
    where name = p_name;
  end if;
end;
$$;

-- Synthetic actors and contexts.
insert into auth.users (id, instance_id, aud, role, email)
values
  ('92000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r20-parent@test.invalid'),
  ('92000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r20-shadchan@test.invalid'),
  ('92000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r20-not-in-this-run@test.invalid');

insert into public.accounts (name, kind)
values ('r20 listing root', 'household')
returning id as root_account_id \gset
insert into public.accounts (name, kind)
values ('r20 listing shadchanus', 'shadchanus')
returning id as shadchanus_account_id \gset
insert into public.accounts (name, kind)
values ('r20 other run', 'household')
returning id as other_account_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:root_account_id, '92000000-0000-0000-0000-000000000001', 'parent_admin', 'active')
returning id as parent_member_id \gset
insert into public.account_members (account_id, user_id, role, status)
values (:shadchanus_account_id, '92000000-0000-0000-0000-000000000002', 'shadchan', 'active')
returning id as shadchan_member_id \gset
insert into public.account_members (account_id, user_id, role, status)
values (:root_account_id, '92000000-0000-0000-0000-000000000003', 'parent_admin', 'active')
returning id as not_run_member_id \gset

insert into public.singles (account_id, first_name_en, gender)
values (:root_account_id, 'R20 Single One', 'female')
returning id as single_one_id \gset
insert into public.singles (account_id, first_name_en, gender)
values (:root_account_id, 'R20 Single Two', 'female')
returning id as single_two_id \gset

insert into public.member_state (user_id, active_account_id)
values
  ('92000000-0000-0000-0000-000000000001', :root_account_id),
  ('92000000-0000-0000-0000-000000000002', :shadchanus_account_id)
on conflict (user_id) do update
set active_account_id = excluded.active_account_id, updated_at = now();

insert into public.demo_runs (
  root_account_id, status, lease_expires_at, lease_token, operation
)
values (
  :root_account_id, 'seeding', now() + interval '10 minutes',
  'r20-valid-lease', 'seed'
)
returning id as run_id \gset
insert into public.demo_run_accounts (run_id, account_id, context_key, context_kind, is_root)
values
  (:run_id, :root_account_id, 'primary-household', 'household', true),
  (:run_id, :shadchanus_account_id, 'r20-shadchanus', 'shadchanus', false);
insert into public.demo_run_users (run_id, user_id, actor_key, email_domain)
values
  (:run_id, '92000000-0000-0000-0000-000000000001', 'r20-parent', 'invalid'),
  (:run_id, '92000000-0000-0000-0000-000000000002', 'r20-shadchan', 'invalid');
insert into public.demo_run_actor_intents
  (run_id, actor_key, expected_email, auth_user_id, state)
values
  (:run_id, 'r20-parent', 'r20-parent@test.invalid',
    '92000000-0000-0000-0000-000000000001', 'reconciled'),
  (:run_id, 'r20-shadchan', 'r20-shadchan@test.invalid',
  '92000000-0000-0000-0000-000000000002', 'reconciled');

select set_config('official_demo.r20_run_id', :'run_id', true);
select set_config('official_demo.r20_root_account_id', :'root_account_id', true);
select set_config('official_demo.r20_single_two_id', :'single_two_id', true);
select set_config('official_demo.r20_parent_member_id', :'parent_member_id', true);

insert into public.demo_runs (
  root_account_id, status, lease_expires_at, lease_token, operation
)
values (
  :other_account_id, 'seeding', now() + interval '10 minutes',
  'r20-other-lease', 'seed'
)
returning id as other_run_id \gset
insert into public.demo_run_accounts (run_id, account_id, context_key, context_kind, is_root)
values (:other_run_id, :other_account_id, 'primary-household', 'household', true);

-- The real actor-authenticated INSERT paths have no SELECT/RETURNING. The
-- write barrier admits these registered actors while RLS keeps seeding rows
-- invisible to authenticated SELECT.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"92000000-0000-0000-0000-000000000002","role":"authenticated"}';
insert into public.listings (
  account_id, listing_type, published_by_member_id,
  shadchan_name, shadchan_area, shadchan_contact_info
) values (
  :shadchanus_account_id, 'shadchan', :shadchan_member_id,
  'R20 Shadchan', 'Stack 2', 'Synthetic contact'
);
reset role;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"92000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.listings (
  account_id, listing_type, single_id, published_by_member_id,
  single_first_name_en, single_age, single_location
) values (
  :root_account_id, 'single', :single_one_id, :parent_member_id,
  'R20 Single One', 24, 'Baltimore'
);
reset role;

insert into results (name, passed, detail)
select 'actor no-returning inserts create both listing rows', count(*) = 2,
       format('listing rows: %s', count(*))
from public.listings
where account_id in (:root_account_id, :shadchanus_account_id);

-- A RETURNING clause needs SELECT visibility. Active-only preview is still
-- false during seeding, so the same actor write must be denied only when it
-- asks PostgreSQL to return the hidden row.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"92000000-0000-0000-0000-000000000001","role":"authenticated"}';
select pg_temp.check_denied(
  'authenticated INSERT RETURNING remains denied by active-only listing SELECT',
  format($sql$
    insert into public.listings (
      account_id, listing_type, single_id, published_by_member_id,
      single_first_name_en
    ) values (%s, 'single', %s, %s, 'R20 Single Two') returning id
  $sql$, :root_account_id, :single_two_id, :parent_member_id),
  '42501', '%listings%'
);
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
set local request.headers =
  '{}';
select pg_temp.check_denied(
  'service resolver without exact headers is denied',
  format($sql$
    select public.resolve_demo_listing_id(%s, 'r20-valid-lease', %s,
      'shadchan', null, %s)
  $sql$, :run_id, :shadchanus_account_id, :shadchan_member_id),
  '42501', '%exact seed service lease%'
);
reset role;

-- The service RPC resolves both types and registers each resource in the
-- same transaction. Repeating a resolution is the response-loss retry case.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select set_config(
  'request.headers',
  json_build_object(
    'x-demo-run-id', :'run_id',
    'x-demo-lease-token', 'r20-valid-lease'
  )::text,
  true
);
select public.resolve_demo_listing_id(
  :run_id, 'r20-valid-lease', :shadchanus_account_id,
  'shadchan', null, :shadchan_member_id
) as shadchan_listing_id \gset
select public.resolve_demo_listing_id(
  :run_id, 'r20-valid-lease', :root_account_id,
  'single', :single_one_id, :parent_member_id
) as single_listing_id \gset
select public.resolve_demo_listing_id(
  :run_id, 'r20-valid-lease', :shadchanus_account_id,
  'shadchan', null, :shadchan_member_id
) as shadchan_retry_id \gset
select public.resolve_demo_listing_id(
  :run_id, 'r20-valid-lease', :root_account_id,
  'single', :single_one_id, :parent_member_id
) as single_retry_id \gset
reset role;

insert into results (name, passed, detail)
values
  ('shadchan listing resolves and registers',
    :'shadchan_listing_id' = :'shadchan_retry_id',
    format('first=%s retry=%s', :'shadchan_listing_id', :'shadchan_retry_id')),
  ('single listing resolves and registers',
    :'single_listing_id' = :'single_retry_id',
    format('first=%s retry=%s', :'single_listing_id', :'single_retry_id')),
  ('repeated resolution is idempotent',
    (select count(*) = 2 from public.demo_run_resources
     where run_id = :run_id and resource_type = 'listing'),
    'listing resource count remains 2');

-- Reproduce the real seed lifecycle: resolve the root single listing, withdraw
-- it under the exact seed lease, then retain only the durable tombstone. A
-- second call is the idempotent response-loss retry.
select public.withdraw_demo_listing(
  :run_id, 'r20-valid-lease', :root_account_id, :single_one_id,
  :parent_member_id
) as withdrawal_result \gset
select public.withdraw_demo_listing(
  :run_id, 'r20-valid-lease', :root_account_id, :single_one_id,
  :parent_member_id
) as withdrawal_retry_result \gset
insert into results (name, passed, detail)
values
  ('withdrawal removes the live listing and registers one tombstone',
    (:'withdrawal_result'::jsonb ->> 'outcome') = 'withdrawn'
    and :'withdrawal_retry_result'::jsonb ->> 'outcome' = 'already_withdrawn'
    and not exists (select 1 from public.listings where id = :'single_listing_id'::bigint)
    and not exists (select 1 from public.demo_run_resources
                    where run_id = :run_id and resource_type = 'listing'
                      and resource_id = :'single_listing_id'::bigint)
    and (select count(*) = 1 from public.demo_run_resources
         where run_id = :run_id and resource_type = 'listing_withdrawal'
           and resource_id = :single_one_id)
    and (select count(*) = 1 from public.listing_withdrawal_locks
         where account_id = :root_account_id and single_id = :single_one_id),
    :'withdrawal_result' || ' retry=' || :'withdrawal_retry_result');

-- Inject a failure at lock creation. The withdrawal must roll back its delete
-- and manifest mutation as one SQL transaction.
create function pg_temp.fail_withdrawal_lock() returns trigger
language plpgsql as $$
begin
  raise exception 'injected withdrawal lock failure' using errcode = 'check_violation';
end;
$$;
create trigger r21_injected_withdrawal_failure
before insert on public.listing_withdrawal_locks
for each row execute function pg_temp.fail_withdrawal_lock();
insert into public.listings (
  account_id, listing_type, single_id, published_by_member_id,
  single_first_name_en
) values (
  :root_account_id, 'single', :single_two_id, :parent_member_id, 'R20 Single Two'
);
select public.resolve_demo_listing_id(
  :run_id, 'r20-valid-lease', :root_account_id,
  'single', :single_two_id, :parent_member_id
) as second_single_listing_id \gset
select set_config('official_demo.r20_second_listing_id', :'second_single_listing_id', true);
do $$
begin
  begin
    perform public.withdraw_demo_listing(
      current_setting('official_demo.r20_run_id')::bigint,
      'r20-valid-lease',
      current_setting('official_demo.r20_root_account_id')::bigint,
      current_setting('official_demo.r20_single_two_id')::bigint,
      current_setting('official_demo.r20_parent_member_id')::bigint
    );
    insert into results values ('withdrawal conflict rolls back atomically', false, 'unexpected success');
  exception when others then
    insert into results
    select 'withdrawal conflict rolls back atomically',
      exists (select 1 from public.listings where id = current_setting('official_demo.r20_second_listing_id')::bigint)
      and exists (select 1 from public.demo_run_resources
                  where run_id = current_setting('official_demo.r20_run_id')::bigint and resource_type = 'listing'
                    and resource_id = current_setting('official_demo.r20_second_listing_id')::bigint),
      sqlerrm;
  end;
end;
$$;
drop trigger r21_injected_withdrawal_failure on public.listing_withdrawal_locks;
select public.withdraw_demo_listing(
  :run_id, 'r20-valid-lease', :root_account_id, :single_two_id,
  :parent_member_id
) as second_withdrawal_result \gset
insert into results
select 'second subject withdrawal also leaves no public listing',
  :'second_withdrawal_result'::jsonb ->> 'outcome' = 'withdrawn'
  and not exists (select 1 from public.listings where id = :'second_single_listing_id'::bigint)
  and not exists (select 1 from public.listings where account_id = :root_account_id and single_id = :single_two_id)
  and (select count(*) = 1 from public.demo_run_resources
       where run_id = :run_id and resource_type = 'listing_withdrawal'
         and resource_id = :single_two_id),
  :'second_withdrawal_result';

-- Every resolver rejection is also required to be side-effect free. These
-- probes cover the lease/run lifecycle, request transport, type contract, and
-- the publisher actor manifest without relying on a SELECT/RETURNING path.
select set_config(
  'request.headers',
  json_build_object(
    'x-demo-run-id', :'run_id',
    'x-demo-lease-token', 'wrong-lease'
  )::text,
  true
);
select pg_temp.check_resolver_denied(
  'correct run with wrong lease is denied without a manifest row',
  format($sql$
    select public.resolve_demo_listing_id(%s, 'wrong-lease', %s,
      'shadchan', null, %s)
  $sql$, :run_id, :shadchanus_account_id, :shadchan_member_id),
  '42501', '%lease or account ownership%'
);
select set_config(
  'request.headers',
  json_build_object(
    'x-demo-run-id', :'run_id',
    'x-demo-lease-token', 'r20-valid-lease'
  )::text,
  true
);

update public.demo_runs set operation = 'clear' where id = :run_id;
select pg_temp.check_resolver_denied(
  'wrong operation is denied without a manifest row',
  format($sql$
    select public.resolve_demo_listing_id(%s, 'r20-valid-lease', %s,
      'shadchan', null, %s)
  $sql$, :run_id, :shadchanus_account_id, :shadchan_member_id),
  '42501', '%lease or account ownership%'
);
update public.demo_runs set operation = 'seed' where id = :run_id;
select pg_temp.check_resolver_denied(
  'invalid listing type is denied without a manifest row',
  format($sql$
    select public.resolve_demo_listing_id(%s, 'r20-valid-lease', %s,
      'not-a-listing-type', null, %s)
  $sql$, :run_id, :shadchanus_account_id, :shadchan_member_id),
  '42501', '%exact seed service lease%'
);
select pg_temp.check_resolver_denied(
  'listing type and single id mismatch is denied without a manifest row',
  format($sql$
    select public.resolve_demo_listing_id(%s, 'r20-valid-lease', %s,
      'shadchan', %s, %s)
  $sql$, :run_id, :shadchanus_account_id, :single_one_id, :shadchan_member_id),
  '42501', '%exact seed service lease%'
);
select pg_temp.check_resolver_denied(
  'publisher absent from this run actor manifest is denied',
  format($sql$
    select public.resolve_demo_listing_id(%s, 'r20-valid-lease', %s,
      'single', %s, %s)
  $sql$, :run_id, :root_account_id, :single_two_id, :not_run_member_id),
  '42501', '%publisher is not registered%'
);

select set_config('request.headers', '{not-json', true);
select pg_temp.check_resolver_denied(
  'invalid request headers JSON is controlled denial without a manifest row',
  format($sql$
    select public.resolve_demo_listing_id(%s, 'r20-valid-lease', %s,
      'shadchan', null, %s)
  $sql$, :run_id, :shadchanus_account_id, :shadchan_member_id),
  '42501', '%valid seed request headers%'
);
select set_config(
  'request.headers',
  json_build_object(
    'x-demo-run-id', :'run_id',
    'x-demo-lease-token', 'r20-valid-lease'
  )::text,
  true
);

select set_config(
  'request.headers',
  json_build_object(
    'x-demo-run-id', :'run_id',
    'x-demo-lease-token', 'r20-valid-lease'
  )::text,
  true
);
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"92000000-0000-0000-0000-000000000001","role":"authenticated"}';
select pg_temp.check_denied(
  'authenticated role cannot execute the resolver',
  format($sql$
    select public.resolve_demo_listing_id(%s, 'r20-valid-lease', %s,
      'shadchan', null, %s)
  $sql$, :run_id, :shadchanus_account_id, :shadchan_member_id),
  '42501', '%permission denied%'
);
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select pg_temp.check_denied(
  'anon role cannot execute the resolver',
  format($sql$
    select public.resolve_demo_listing_id(%s, 'r20-valid-lease', %s,
      'shadchan', null, %s)
  $sql$, :run_id, :shadchanus_account_id, :shadchan_member_id),
  '42501', '%permission denied%'
);
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select set_config(
  'request.headers',
  json_build_object(
    'x-demo-run-id', :'other_run_id',
    'x-demo-lease-token', 'r20-other-lease'
  )::text,
  true
);
select pg_temp.check_denied(
  'wrong run cannot resolve a listing',
  format($sql$
    select public.resolve_demo_listing_id(%s, 'r20-other-lease', %s,
      'shadchan', null, %s)
  $sql$, :other_run_id, :shadchanus_account_id, :shadchan_member_id),
  '42501', '%lease or account ownership%'
);
select set_config(
  'request.headers',
  json_build_object(
    'x-demo-run-id', :'run_id',
    'x-demo-lease-token', 'r20-valid-lease'
  )::text,
  true
);
select pg_temp.check_denied(
  'wrong account cannot resolve a listing',
  format($sql$
    select public.resolve_demo_listing_id(%s, 'r20-valid-lease', %s,
      'shadchan', null, %s)
  $sql$, :run_id, :other_account_id, :shadchan_member_id),
  '42501', '%lease or account ownership%'
);
select pg_temp.check_denied(
  'wrong publisher cannot resolve a listing',
  format($sql$
  select public.resolve_demo_listing_id(%s, 'r20-valid-lease', %s,
      'shadchan', null, %s)
  $sql$, :run_id, :shadchanus_account_id, :parent_member_id),
  '42501', '%publisher is not registered%'
);

-- Two exact matching rows are impossible in normal schema operation because
-- the listing branch has a partial unique index. Dropping that index inside
-- this rollback-only proof creates the adversarial ambiguity without leaving
-- any schema change behind.
reset role;
drop index public.listings_shadchan_account_id_key;
insert into public.listings (
  account_id, listing_type, published_by_member_id, shadchan_name
) values (
  :shadchanus_account_id, 'shadchan', :shadchan_member_id, 'R20 Ambiguous'
);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select pg_temp.check_denied(
  'ambiguous exact listing match fails closed',
  format($sql$
    select public.resolve_demo_listing_id(%s, 'r20-valid-lease', %s,
      'shadchan', null, %s)
  $sql$, :run_id, :shadchanus_account_id, :shadchan_member_id),
  '21000', '%ambiguous%'
);

update public.demo_runs
set lease_expires_at = now() - interval '1 second'
where id = :run_id;
select pg_temp.check_denied(
  'expired lease cannot resolve a listing',
  format($sql$
    select public.resolve_demo_listing_id(%s, 'r20-valid-lease', %s,
      'shadchan', null, %s)
  $sql$, :run_id, :shadchanus_account_id, :shadchan_member_id),
  '42501', '%lease or account ownership%'
);
reset role;

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
