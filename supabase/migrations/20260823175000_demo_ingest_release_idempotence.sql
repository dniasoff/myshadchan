-- The release RPC deletes the claim row. A repeated release is a harmless
-- replay, so terminal claim receipts cannot accumulate after ordinary ingest.
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
  return true;
end;
$$;
