set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.shidduch_storage_path_allowed(p_bucket text, p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_shidduch_id bigint;
begin
  if v_account_id is null or p_bucket is null or p_name is null then
    return false;
  end if;

  if p_bucket = 'documents'
     and p_name ~ ('^' || v_account_id::text || '/resumes/single-[0-9]+/[^/]+$') then
    return true;
  end if;
  if p_bucket = 'documents'
     and p_name ~ ('^' || v_account_id::text || '/photos/(shared|private_parent)/single-[0-9]+/[^/]+$') then
    return true;
  end if;
  if p_bucket = 'entity-files'
     and p_name ~ ('^' || v_account_id::text || '/(reference|shadchan|single|connection)/[0-9]+/[^/]+$') then
    return true;
  end if;

  if p_bucket = 'documents'
     and p_name ~ ('^' || v_account_id::text || '/resumes/[0-9]+/[^/]+$') then
    v_shidduch_id := split_part(p_name, '/', 3)::bigint;
  elsif p_bucket = 'documents'
     and p_name ~ ('^' || v_account_id::text || '/photos/(shared|private_parent)/[0-9]+/[^/]+$') then
    v_shidduch_id := split_part(p_name, '/', 4)::bigint;
  elsif p_bucket = 'entity-files'
     and p_name ~ ('^' || v_account_id::text || '/shidduch/[0-9]+/[^/]+$') then
    v_shidduch_id := split_part(p_name, '/', 3)::bigint;
  else
    return false;
  end if;

  return not exists (
    select 1
    from public.deleted_shidduch_tombstones t
    where t.account_id = v_account_id and t.shidduch_id = v_shidduch_id
  );
end;
$function$
;
