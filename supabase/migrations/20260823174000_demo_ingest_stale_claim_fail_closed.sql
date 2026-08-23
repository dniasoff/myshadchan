-- A stale ordinary claim has no durable registration for its external
-- attachment path. Keep seed blocked until the worker/operator resolves it;
-- never mark it expired and proceed over an unknown write boundary.
create or replace function public.wait_for_demo_ingest_account_claims(
    p_account_id bigint,
    p_timeout_seconds integer default 30
) returns boolean
language plpgsql volatile security definer
set search_path to ''
as $$
declare
  v_deadline timestamp with time zone := clock_timestamp()
    + make_interval(secs => greatest(1, least(coalesce(p_timeout_seconds, 30), 120)));
  v_active integer;
begin
  loop
    if exists (
      select 1 from public.demo_run_ingest_claims
      where account_id = p_account_id
        and state = 'active'
        and expires_at <= clock_timestamp()
    ) then
      raise exception 'stale ordinary ingest claim blocks demo seed' using errcode = '55P03';
    end if;
    delete from public.demo_run_ingest_claims
    where account_id = p_account_id and state in ('released', 'expired');
    select count(*)::integer into v_active
    from public.demo_run_ingest_claims
    where account_id = p_account_id and state = 'active';
    if v_active = 0 then return true; end if;
    if clock_timestamp() >= v_deadline then
      raise exception 'ordinary ingest claims are still active' using errcode = '55P03';
    end if;
    perform pg_sleep(0.05);
  end loop;
end;
$$;

create or replace function public.release_demo_ingest_claim(
    p_account_id bigint,
    p_claim_token text
) returns boolean
language plpgsql volatile security definer
set search_path to ''
as $$
declare
  v_hash text;
begin
  if p_claim_token is null or length(p_claim_token) < 16 or length(p_claim_token) > 256 then
    return false;
  end if;
  v_hash := encode(extensions.digest(p_claim_token, 'sha256'), 'hex');
  delete from public.demo_run_ingest_claims
  where account_id = p_account_id and claim_token_hash = v_hash;
  if found then
    return true;
  end if;
  return true;
end;
$$;
