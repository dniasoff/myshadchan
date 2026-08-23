\set ON_ERROR_STOP on

begin;

do $$
declare
  v_account_id bigint;
  v_run_id bigint;
  v_result jsonb;
begin
  insert into public.accounts (name, kind, demo)
  values ('r16 lifecycle fixture', 'household', false)
  returning id into v_account_id;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'demo_run_ingest_claims'
      and c.relrowsecurity
      and c.relforcerowsecurity
  ) then
    raise exception 'demo ingest claims must enable and force row level security';
  end if;
  if has_table_privilege('anon', 'public.demo_run_ingest_claims', 'select')
     or has_table_privilege('authenticated', 'public.demo_run_ingest_claims', 'select')
     or not has_table_privilege('service_role', 'public.demo_run_ingest_claims', 'insert') then
    raise exception 'demo ingest claim table grants are not service-only';
  end if;

  -- Ordinary ingest is admitted only through the durable claim, and the
  -- release path removes the terminal row rather than leaving a receipt.
  v_result := public.claim_demo_ingest(v_account_id, 'r16-ordinary-token');
  if v_result->>'outcome' <> 'claimed' then
    raise exception 'ordinary ingest was not claimed';
  end if;
  if not public.heartbeat_demo_ingest_claim(v_account_id, 'r16-ordinary-token') then
    raise exception 'ordinary ingest heartbeat was not accepted';
  end if;
  if not public.release_demo_ingest_claim(v_account_id, 'r16-ordinary-token') then
    raise exception 'ordinary ingest release was not idempotently accepted';
  end if;
  if exists (
    select 1 from public.demo_run_ingest_claims where account_id = v_account_id
  ) then
    raise exception 'ordinary ingest claim survived release';
  end if;

  -- An expired ordinary claim is an unknown external-write boundary. Seeding
  -- must fail closed instead of guessing that the worker is gone.
  v_result := public.claim_demo_ingest(v_account_id, 'r16-stale-token-x');
  update public.demo_run_ingest_claims
  set expires_at = clock_timestamp() - interval '1 second'
  where account_id = v_account_id;
  begin
    perform public.wait_for_demo_ingest_account_claims(v_account_id, 1);
    raise exception 'stale ordinary claim did not block seed';
  exception when sqlstate '55P03' then
    null;
  end;
  delete from public.demo_run_ingest_claims where account_id = v_account_id;

  insert into public.demo_runs (
    root_account_id, status, seed_version, lease_epoch, lease_expires_at,
    lease_token, operation
  ) values (
    v_account_id, 'clearing', 'r16-test', 1,
    clock_timestamp() + interval '5 minutes', 'r16-clear-lease', 'clear'
  ) returning id into v_run_id;
  insert into public.demo_run_accounts (
    run_id, account_id, context_key, context_kind, is_root
  ) values (v_run_id, v_account_id, 'primary-household', 'household', true);

  -- All unfinished demo phases, including active, reject inbound work before
  -- parsing or any attachment/inbox write.
  v_result := public.claim_demo_ingest(v_account_id, 'r16-active-token');
  if v_result->>'outcome' <> 'blocked' then
    raise exception 'demo ingest was admitted during clear';
  end if;
  if exists (
    select 1 from public.demo_run_ingest_claims where account_id = v_account_id
  ) then
    raise exception 'blocked demo ingest left a claim row';
  end if;

  -- A stale claim on the clearing bundle is anomalous. Clear must not expire
  -- it and sweep past a worker that can still commit an external write.
  insert into public.demo_run_ingest_claims (
    run_id, account_id, claim_token_hash, state, expires_at
  ) values (
    v_run_id, v_account_id,
    encode(extensions.digest('r16-clear-stale-token', 'sha256'), 'hex'),
    'active', clock_timestamp() - interval '1 second'
  );
  begin
    perform public.wait_for_demo_ingest_claims(v_run_id, 'r16-clear-lease', 1);
    raise exception 'stale clear claim did not block sweep';
  exception when sqlstate '55P03' then
    null;
  end;
  delete from public.demo_run_ingest_claims where run_id = v_run_id;

  -- The storage fence has the same lifecycle boundary: clearing rejects a
  -- customer upload, while an active showcase remains readable/writable only
  -- through the existing active-demo policy path.
  if public.demo_storage_write_fence(v_account_id) then
    raise exception 'storage fence admitted a clearing account';
  end if;
  update public.demo_runs set status = 'active' where id = v_run_id;
  if not public.demo_storage_write_fence(v_account_id) then
    raise exception 'storage fence rejected an active demo account';
  end if;
end;
$$;

rollback;
select 'R16_OK';
