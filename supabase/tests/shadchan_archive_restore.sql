-- Shadchan archive/restore lifecycle. The transaction rolls back, so this
-- suite leaves the local database unchanged.

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table fixture_ids (name text primary key, value bigint) on commit drop;
grant all on results to public;
grant all on fixture_ids to public;

insert into auth.users (id, instance_id, aud, role, email)
values ('5f0a0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fwj-shadchan@test.local')
on conflict (id) do nothing;

delete from public.account_members;
insert into public.accounts (name, kind) values ('fwj shadchan archive', 'household') returning id as account_id \gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_id, '5f0a0000-0000-0000-0000-000000000001', 'parent_admin', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"5f0a0000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.set_active_context(:account_id);

insert into public.singles (account_id, first_name_en, last_name_en)
values (:account_id, 'fwj', 'Single') returning id as single_id \gset
insert into public.shadchanim (account_id, name)
values (:account_id, 'Archived candidate') returning id as shadchan_id \gset

select id as shidduch_id
from public.create_shidduch(
  p_single_id => :single_id,
  p_shadchan_id => :shadchan_id,
  p_name_en => 'Linked candidate'
)
\gset
insert into fixture_ids (name, value)
values ('shadchan_id', :shadchan_id), ('shidduch_id', :shidduch_id);

-- A queued reminder for this target must be suppressed by archive and
-- re-armed by restore. Queue internals are service-role-only, so arrange and
-- inspect this fixture as postgres while the lifecycle calls below remain
-- authenticated manager calls.
set local role postgres;
select id as reminder_member_id
from public.members
where user_id = '5f0a0000-0000-0000-0000-000000000001'
\gset
insert into public.tasks (
  account_id, target_type, target_id, text, due_date, member_id,
  delivery_channels
)
values (
  :account_id, 'shadchan', :shadchan_id, 'Archive reminder',
  now() - interval '1 hour', :reminder_member_id, array['email']
)
returning id as reminder_task_id
\gset
select public.enqueue_due_task_notifications(now()) as reminder_enqueue_count
\gset
insert into results
select 'active shadchan reminder is queued',
  :reminder_enqueue_count = 1
    and status = 'pending'
    and error is null,
  format('enqueue=%s status=%s error=%s', :reminder_enqueue_count, status, error)
from public.task_notifications
where task_id = :reminder_task_id;
set local role authenticated;

select id as redt_shadchan_id
from public.archive_shadchan(:shadchan_id)
\gset

set local role postgres;
insert into results
select 'archive marks the shadchan and returns it',
  :redt_shadchan_id = :shadchan_id
    and (select archived_at is not null from public.shadchanim where id = :shadchan_id),
  format('returned id=%s', :redt_shadchan_id);

insert into results
select 'archive suppresses queued shadchan reminders',
  status = 'skipped' and error = 'shadchan archived',
  format('status=%s error=%s', status, error)
from public.task_notifications
where task_id = :reminder_task_id;
set local role authenticated;

-- Archived targets cannot be used for newly-created links.
do $$
begin
  perform public.add_redt(
    (select value from fixture_ids where name = 'shidduch_id'),
    (select value from fixture_ids where name = 'shadchan_id')
  );
  insert into results values ('add_redt rejects archived shadchan', false, 'no error');
exception when others then
  insert into results values ('add_redt rejects archived shadchan', sqlerrm like '%not found%', sqlerrm);
end;
$$;

insert into results
select 'archived shadchan is hidden from the active base-table read',
  count(*) = 0,
  format('visible rows=%s', count(*))
from public.shadchanim
where id = :shadchan_id;

insert into results
select 'archived shadchan name is hidden from shidduchim_summary',
  shadchan_name is null
    and shadchan_name_he is null
    and first_suggested_by is null,
  format('name=%s first_suggested_by=%s',
    coalesce(shadchan_name, '<null>'),
    coalesce(first_suggested_by::text, '<null>'))
from public.shidduchim_summary
where id = :shidduch_id;

insert into results
select 'archived shadchan is absent from productivity stats',
  count(*) = 0,
  format('stats rows=%s', count(*))
from public.shadchan_stats
where id = :shadchan_id;

select id as restored_id
from public.restore_shadchan(:shadchan_id)
\gset

set local role postgres;
insert into results
select 'restore re-arms shadchan reminders',
  status = 'pending' and error is null,
  format('status=%s error=%s', status, error)
from public.task_notifications
where task_id = :reminder_task_id;
set local role authenticated;

insert into results
select 'restore re-arms the active shadchan row',
  :restored_id = :shadchan_id
    and (select archived_at is null from public.shadchanim where id = :shadchan_id)
    and (select first_suggested_by = :shadchan_id
         from public.shidduchim_summary where id = :shidduch_id),
  format('returned id=%s', :restored_id);

-- Repeating restore is a no-op success.
insert into results
select 'restore is idempotent',
  count(*) = 1 and bool_and(archived_at is null),
  format('rows=%s', count(*))
from public.restore_shadchan(:shadchan_id);

-- Repeating archive is a clear, non-mutating error.
do $$
begin
  perform public.archive_shadchan(
    (select value from fixture_ids where name = 'shadchan_id')
  );
  perform public.archive_shadchan(
    (select value from fixture_ids where name = 'shadchan_id')
  );
  insert into results values ('duplicate archive reports already archived', false, 'no error');
exception when check_violation then
  insert into results values ('duplicate archive reports already archived', true, sqlerrm);
end;
$$;

-- Server-side role gate: a single cannot archive, even though it can read the
-- active shadchan book.
set local role postgres;
update public.account_members
set role = 'single'
where account_id = :account_id
  and user_id = '5f0a0000-0000-0000-0000-000000000001';
set local role authenticated;
do $$
begin
  perform public.archive_shadchan(
    (select value from fixture_ids where name = 'shadchan_id')
  );
  insert into results values ('single cannot archive a shadchan', false, 'no error');
exception when insufficient_privilege then
  insert into results values ('single cannot archive a shadchan', true, sqlerrm);
end;
$$;

-- Archive-only fence: an authenticated manager cannot bypass the lifecycle
-- RPC with a direct hard delete. The service/account-delete path remains
-- able to purge the row below.
set local role postgres;
update public.account_members
set role = 'parent_admin'
where account_id = :account_id
  and user_id = '5f0a0000-0000-0000-0000-000000000001';
set local role authenticated;
do $$
begin
  delete from public.shadchanim
  where id = (select value from fixture_ids where name = 'shadchan_id');
  insert into results values ('authenticated cannot hard-delete a shadchan', false, 'delete unexpectedly succeeded');
exception when insufficient_privilege then
  insert into results values ('authenticated cannot hard-delete a shadchan', true, sqlerrm);
end;
$$;

-- The underlying FK behavior remains intact: the account-delete service path
-- unassigns the suggestion, first provenance, and redt without deleting it.
set local role postgres;
delete from public.shadchanim where id = :shadchan_id;
insert into results
select 'hard delete clears shadchan references',
  s.shadchan_id is null
    and s.first_suggested_by is null
    and not exists (
      select 1 from public.redts r
      where r.shidduchim_id = s.id and r.shadchan_id is not null
    ),
  format('shadchan_id=%s first_suggested_by=%s', s.shadchan_id, s.first_suggested_by)
from public.shidduchim s
where s.id = :shidduch_id;

-- Account deletion is the permanent purge fence and includes archived rows.
insert into public.shadchanim (account_id, name)
values (:account_id, 'Archived account-delete row') returning id as second_shadchan_id \gset
update public.shadchanim set archived_at = now() where id = :second_shadchan_id;
delete from public.accounts where id = :account_id;
insert into results
select 'account deletion purges archived shadchanim',
  count(*) = 0,
  format('remaining rows=%s', count(*))
from public.shadchanim
where account_id = :account_id;

\pset format unaligned
\pset tuples_only on
\pset columns 0
\t on
\a
select coalesce(json_agg(row_to_json(results) order by name), '[]'::json)::text from results;
rollback;
