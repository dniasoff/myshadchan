set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sales_count int;
  v_account_id bigint;
begin
  select count(id) into sales_count
  from public.sales;

  insert into public.sales (first_name, last_name, email, user_id, administrator)
  values (
    coalesce(
      nullif(new.raw_user_meta_data ->> 'first_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', ''),
      nullif(new.raw_user_meta_data ->> 'given_name', ''),
      nullif(split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ' ', 1), ''),
      'Pending'),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'last_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', ''),
      nullif(new.raw_user_meta_data ->> 'family_name', ''),
      case when position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')) > 0
           then substr(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')) + 1)
      end,
      'Pending'),
    new.email,
    new.id,
    case when sales_count > 0 then FALSE else TRUE end
  );

  if not exists (select 1 from public.account_members) then
    select a.id into v_account_id
    from public.accounts a
    order by a.id
    limit 1;

    if v_account_id is null then
      insert into public.accounts (name) values ('My Account')
      returning id into v_account_id;
    end if;

    insert into public.account_members (account_id, user_id, role, status)
    values (v_account_id, new.id, 'parent_admin', 'active');
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_update_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.sales
  set
    first_name = coalesce(
      nullif(new.raw_user_meta_data ->> 'first_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', ''),
      nullif(new.raw_user_meta_data ->> 'given_name', ''),
      nullif(split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ' ', 1), ''),
      'Pending'),
    last_name = coalesce(
      nullif(new.raw_user_meta_data ->> 'last_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', ''),
      nullif(new.raw_user_meta_data ->> 'family_name', ''),
      case when position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')) > 0
           then substr(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')) + 1)
      end,
      'Pending'),
    email = new.email
  where user_id = new.id;

  return new;
end;
$function$
;


