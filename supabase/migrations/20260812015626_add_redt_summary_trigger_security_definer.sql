set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.refresh_shidduch_redt_summary()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_shidduch_id bigint;
  v_last_shadchan bigint;
  v_last_date date;
  v_first_shadchan bigint;
  v_first_date date;
begin
  v_shidduch_id := coalesce(new.shidduchim_id, old.shidduchim_id);

  select r.shadchan_id, r.redt_date into v_last_shadchan, v_last_date
  from public.redts r
  where r.shidduchim_id = v_shidduch_id
  order by r.redt_date desc, r.id desc
  limit 1;

  if not found then
    -- No redts remain (e.g. the last one was deleted); leave the summary as-is.
    return null;
  end if;

  select r.shadchan_id, r.redt_date into v_first_shadchan, v_first_date
  from public.redts r
  where r.shidduchim_id = v_shidduch_id
  order by r.redt_date asc, r.id asc
  limit 1;

  update public.shidduchim s
  set redt_date = v_last_date,
      shadchan_id = v_last_shadchan,
      first_suggested_by = v_first_shadchan,
      first_suggested_at = v_first_date
  where s.id = v_shidduch_id;

  return null;
end;
$function$
;


