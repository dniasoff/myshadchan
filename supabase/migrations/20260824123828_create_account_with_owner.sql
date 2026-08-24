-- Give a service-role caller an atomic way to create an account.
--
-- 20260824115601 made a committed account with no active membership illegal.
-- PostgREST gives a REST client one transaction per request, so
-- `insert accounts` then `insert account_members` is two commits and the
-- first is an orphan -- which is not merely awkward, it is the defect: if the
-- second request never lands, the account is stranded forever.
--
-- An invariant that forbids a state has to come with a way to reach the good
-- one, or it just makes a legitimate operation impossible. In-product account
-- creation was already atomic (add_persona, create_demo_companion_context);
-- this is for service-role callers that can only speak REST.

CREATE OR REPLACE FUNCTION "public"."create_account_with_owner"(
  "p_name" "text",
  "p_kind" "text",
  "p_user_id" "uuid",
  "p_role" "text" DEFAULT 'parent_admin'::"text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_membership_id bigint;
begin
  -- The atomic way for a service-role caller to create an account.
  --
  -- assert_account_not_orphaned() rejects a COMMITTED account with no active
  -- membership, and PostgREST gives a REST client one transaction per
  -- request -- so `insert accounts` followed by `insert account_members` is
  -- two commits and the first one is an orphan. That is not a technicality:
  -- if the second request never lands (a crash, a dropped connection, a bug
  -- in between) the account is stranded forever, which is the exact defect
  -- the invariant exists to prevent.
  --
  -- An invariant that forbids a state must come with a way to reach the good
  -- one, or it just makes a legitimate operation impossible. This is that
  -- way: one statement, one transaction, both rows or neither.
  --
  -- In-product account creation does NOT go through here -- add_persona()
  -- and create_demo_companion_context() are already single SQL transactions
  -- -- so this is for service-role callers (ops tooling, e2e fixtures) that
  -- can only speak REST.
  if p_user_id is null then
    raise exception 'create_account_with_owner requires an owner'
      using errcode = 'check_violation';
  end if;

  insert into public.accounts (name, kind)
  values (p_name, coalesce(p_kind, 'household'))
  returning id into v_account_id;

  insert into public.account_members (account_id, user_id, role, status)
  values (v_account_id, p_user_id, p_role, 'active')
  returning id into v_membership_id;

  return jsonb_build_object(
    'account_id', v_account_id,
    'membership_id', v_membership_id
  );
end;
$$;

revoke all on function public.create_account_with_owner(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_account_with_owner(text, text, uuid, text) to service_role;
