-- Suggested-by data path: RPC persistence and the approved legacy backfill.
-- The migration is re-run inside this transaction so the backfill is tested
-- against rows shaped like the pre-feature production rows. The transaction
-- rolls back; this suite never changes the local database.

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

insert into auth.users (id, instance_id, aud, role, email)
values ('5cgw0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgw-suggested-by@test.local')
on conflict (id) do nothing;

delete from public.account_members;
insert into public.accounts (name, kind) values ('cgw suggested-by', 'household') returning id as account_id \gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_id, '5cgw0000-0000-0000-0000-000000000001', 'parent_admin', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"5cgw0000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.set_active_context(:account_id);

insert into public.singles (account_id, first_name_en, last_name_en)
values (:account_id, 'cgw', 'Single') returning id as single_id \gset

select id as rpc_shidduch_id
from public.create_shidduch(
  p_single_id => :single_id,
  p_name_en => 'RPC candidate',
  p_suggested_by_name => 'Miriam Cohen',
  p_suggested_by_phone => '+1 555 0100'
)
\gset

insert into results
select 'create_shidduch persists suggested-by fields',
  suggested_by_name = 'Miriam Cohen'
    and suggested_by_phone = '+1 555 0100',
  format('name=%s phone=%s', suggested_by_name, suggested_by_phone)
from public.shidduchim
where id = :rpc_shidduch_id;

select id as backfill_shidduch_id
from public.create_shidduch(
  p_single_id => :single_id,
  p_name_en => 'Backfill candidate'
)
\gset

select id as preserved_shidduch_id
from public.create_shidduch(
  p_single_id => :single_id,
  p_name_en => 'Preserved candidate',
  p_suggested_by_name => 'Already recorded'
)
\gset

-- Shape legacy rows directly; the migration is responsible for the update.
set local role postgres;
insert into public.inbox_items (
  account_id, source, raw_text, sender, status, single_id,
  resolved_shidduchim_id
)
values
  (:account_id, 'email', 'legacy capture', '  Legacy Referrer  ', 'resolved', :single_id, :backfill_shidduch_id),
  (:account_id, 'email', 'preserved capture', 'New Referrer', 'resolved', :single_id, :preserved_shidduch_id);

-- Replay the additive migration to exercise its idempotent backfill path.
\ir ../migrations/20261120090000_suggested_by_fields.sql

insert into results
select 'legacy backfill trims and copies a qualifying sender',
  suggested_by_name = 'Legacy Referrer',
  format('suggested_by_name=%s', suggested_by_name)
from public.shidduchim
where id = :backfill_shidduch_id;

insert into results
select 'legacy backfill never overwrites an existing suggested-by name',
  suggested_by_name = 'Already recorded',
  format('suggested_by_name=%s', suggested_by_name)
from public.shidduchim
where id = :preserved_shidduch_id;

insert into results
select 'suggested-by columns exist',
  count(*) = 2,
  string_agg(column_name, ', ' order by column_name)
from information_schema.columns
where table_schema = 'public'
  and table_name = 'shidduchim'
  and column_name in ('suggested_by_name', 'suggested_by_phone')
union all
select 'suggested-by checks exist',
  count(*) = 2,
  string_agg(conname, ', ' order by conname)
from pg_constraint
where conrelid = 'public.shidduchim'::regclass
  and conname in (
    'shidduchim_suggested_by_name_check',
    'shidduchim_suggested_by_phone_check'
  )
union all
select 'suggested-by grants are readable by authenticated',
  has_column_privilege('authenticated', 'public.shidduchim', 'suggested_by_name', 'SELECT')
    and has_column_privilege('authenticated', 'public.shidduchim', 'suggested_by_phone', 'SELECT'),
  'column SELECT privileges';

select json_agg(results order by name) from results;
rollback;
