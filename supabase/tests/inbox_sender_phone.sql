-- Inbox sender_phone is optional capture metadata. This suite verifies that
-- the additive column follows inbox_items' existing grants/RLS boundary and
-- that service-role ingestion remains NULL when it has no phone source.

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset columns 0

begin;

insert into auth.users (id, instance_id, aud, role, email)
values (
  'c3333333-3333-3333-3333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'inbox-phone@test.local'
);

insert into public.accounts (name, kind)
values ('Inbox Phone Household', 'household')
returning id as acct \gset

insert into public.account_members (account_id, user_id, role, status)
values (:acct, 'c3333333-3333-3333-3333-333333333333', 'parent_admin', 'active');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}';

insert into public.inbox_items (source, raw_text, sender, sender_phone)
values ('upload', 'Phone capture', 'Miriam Cohen', '+1 555-0100')
returning id as client_item \gset

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

insert into public.inbox_items (account_id, source, raw_text, sender)
values (:acct, 'email', 'Service capture', 'someone@example.com')
returning id as service_item \gset

reset role;

select json_agg(row_to_json(results) order by name)
from (
  select
    'client capture stores sender_phone' as name,
    (select sender_phone from public.inbox_items where id = :client_item)
      = '+1 555-0100' as passed,
    null::text as detail
  union all
  select
    'sender_phone check exists with length and control guards',
    exists (
      select 1
      from pg_constraint
      where conrelid = 'public.inbox_items'::regclass
        and conname = 'inbox_items_sender_phone_check'
        and pg_get_constraintdef(oid) like '%char_length(sender_phone)%'
        and pg_get_constraintdef(oid) like '%cntrl%'
    ),
    null::text
  union all
  select
    'authenticated can select and insert inbox_items',
    has_table_privilege('authenticated', 'public.inbox_items', 'SELECT')
      and has_table_privilege('authenticated', 'public.inbox_items', 'INSERT'),
    null::text
  union all
  select
    'service_role can select and insert inbox_items',
    has_table_privilege('service_role', 'public.inbox_items', 'SELECT')
      and has_table_privilege('service_role', 'public.inbox_items', 'INSERT'),
    null::text
  union all
  select
    'service ingestion without a phone remains NULL',
    (select sender_phone is null from public.inbox_items where id = :service_item),
    null::text
  union all
  select
    'Inbox policy excludes single members',
    exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'inbox_items'
        and policyname = 'Inbox items scoped to account'
        and qual like '%current_member_role()%'
        and qual like '%single%'
        and with_check like '%current_member_role()%'
        and with_check like '%single%'
    ),
    null::text
) as results;

rollback;
