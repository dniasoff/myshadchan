-- Automatic Inbox picture promotion must make the "no visible Photo" check
-- part of the same locked transaction as the insert. The existing RPC locks
-- the owning shidduch/single before resolving its resume, so this optional
-- branch is serialized with every other Photo write for that subject.

drop function if exists public.add_resume_photo(text, bigint, bigint, text, bigint);

CREATE OR REPLACE FUNCTION public.add_resume_photo(
  p_path text,
  p_shidduchim_id bigint DEFAULT NULL,
  p_single_id bigint DEFAULT NULL,
  p_visibility text DEFAULT 'shared',
  p_size bigint DEFAULT NULL,
  p_only_if_no_visible_photo boolean DEFAULT false
) RETURNS SETOF public.resume_photos
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_resume_id bigint;
  v_parent_id bigint;
  v_existing_photo public.resume_photos;
begin
  v_account_id := public.current_context_id();
  if public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'new row violates row-level security policy for table "resumes"'
      using errcode = 'insufficient_privilege';
  end if;

  if p_size is not null then
    if p_size < 0 or p_size > 8 * 1024 * 1024 then
      raise exception 'picture must be no larger than 8 MiB'
        using errcode = 'check_violation';
    end if;
    if p_path is null
       or p_path !~ ('^' || v_account_id::text
         || '/photos/(shared|private_parent)/(single-)?[0-9]+/[^/]+\.(jpe?g|png)$') then
      raise exception 'picture must be a JPEG or PNG in the current account'
        using errcode = 'check_violation';
    end if;
  end if;

  if (p_shidduchim_id is not null) = (p_single_id is not null) then
    raise exception 'exactly one of p_shidduchim_id/p_single_id must be provided';
  end if;

  if p_shidduchim_id is not null then
    select s.id into v_parent_id
    from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
    for update;
    perform public.account_storage_lock(v_account_id);
    if v_parent_id is null then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;
    if exists (
      select 1 from public.deleted_shidduch_tombstones t
      where t.account_id = v_account_id and t.shidduch_id = p_shidduchim_id
    ) then
      raise exception 'shidduch % is deleted', p_shidduchim_id
        using errcode = 'foreign_key_violation';
    end if;
    if not exists (
      select 1 from public.shidduchim s
      where s.id = p_shidduchim_id and s.account_id = v_account_id
    ) then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;

    insert into public.resumes (account_id, shidduchim_id)
    values (v_account_id, p_shidduchim_id)
    on conflict (shidduchim_id) where shidduchim_id is not null
      do update set shidduchim_id = excluded.shidduchim_id
    returning id into v_resume_id;
  else
    select s.id into v_parent_id
    from public.singles s
    where s.id = p_single_id and s.account_id = v_account_id
    for update;
    if v_parent_id is null then
      raise exception 'single % not found in current account', p_single_id;
    end if;

    insert into public.resumes (account_id, single_id)
    values (v_account_id, p_single_id)
    on conflict (single_id) where single_id is not null
      do update set single_id = excluded.single_id
    returning id into v_resume_id;
  end if;

  if coalesce(p_only_if_no_visible_photo, false) then
    select rp.* into v_existing_photo
    from public.resume_photos rp
    where rp.resume_id = v_resume_id
      and rp.hidden_at is null
    order by rp.uploaded_at asc, rp.id asc
    limit 1;
    if found then
      return next v_existing_photo;
      return;
    end if;
  end if;

  return query
  insert into public.resume_photos (account_id, resume_id, path, visibility)
  values (v_account_id, v_resume_id, p_path, coalesce(p_visibility, 'shared'))
  returning *;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_resume_photo(
  p_path text,
  p_shidduchim_id bigint DEFAULT NULL,
  p_single_id bigint DEFAULT NULL,
  p_visibility text DEFAULT 'shared',
  p_size bigint DEFAULT NULL
) RETURNS SETOF public.resume_photos
LANGUAGE sql SECURITY DEFINER
SET search_path TO ''
AS $function$
  select *
  from public.add_resume_photo(
    p_path => p_path,
    p_shidduchim_id => p_shidduchim_id,
    p_single_id => p_single_id,
    p_visibility => p_visibility,
    p_size => p_size,
    p_only_if_no_visible_photo => false
  );
$function$;

revoke all on function public.add_resume_photo(text, bigint, bigint, text, bigint, boolean) from public, anon;
grant execute on function public.add_resume_photo(text, bigint, bigint, text, bigint, boolean) to authenticated, service_role;
revoke all on function public.add_resume_photo(text, bigint, bigint, text, bigint) from public, anon;
grant execute on function public.add_resume_photo(text, bigint, bigint, text, bigint) to authenticated, service_role;
