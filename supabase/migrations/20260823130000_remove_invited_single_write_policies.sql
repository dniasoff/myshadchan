-- Invited household singles are a read-only audience.  The actor-scope
-- migration accidentally added permissive FOR ALL policies keyed on the
-- invited `single` role; because permissive policies OR together with the
-- normal manager policy, those policies exposed private suggestions and let
-- an invited single transition a shidduch.  Self-managed singles continue to
-- use the existing account-scoped manager policy through their `self_manager`
-- membership, while this role has no direct shidduchim/singles DML path.
drop policy if exists "Singles writable by self" on public.singles;
drop policy if exists "Shidduchim writable by self" on public.shidduchim;

-- Keep the pre-existing error substring used by tenant-boundary callers. The
-- actor-scope allowlist is intentionally broader for standalone shadchanus,
-- but an invalid table or an RLS-obscured foreign account must still report
-- through the established household-scope vocabulary.
create or replace function public.enforce_household_scope()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if not exists (
    select 1 from public.accounts
    where id = new.account_id
      and (
        kind = 'household'
        or (
          kind = 'shadchanus'
          and tg_table_name in (
            'singles',
            'shadchanim',
            'shidduchim',
            'resumes',
            'resume_photos',
            'references',
            'reference_links',
            'date_records',
            'redts',
            'shidduch_education',
            'shidduchim_external_links',
            'identity_signals'
          )
        )
      )
  ) then
    -- Preserve the established denial vocabulary for cross-account probes
    -- while still allowing the explicit standalone-shadchanus allowlist.
    raise exception 'account % is not a household-kind account or cannot own % domain rows', new.account_id, tg_table_name
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;
