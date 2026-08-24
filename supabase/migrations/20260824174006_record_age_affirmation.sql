-- Ask for the 18+ affirmation, and record it.
--
-- 20260824122333 retired `check_signup_age()` — the `before_user_created`
-- Auth Hook — because the affirmation had to reach the server BEFORE the user
-- existed, and `signInWithOAuth()` has no channel that can carry it. That
-- reasoning was right about the hook and is untouched here: nothing in this
-- migration runs before user creation.
--
-- What it left behind was a passive sentence (`AgeNotice`) and, with the hook
-- gone, a "Continue with Google" on /login that silently creates an account
-- for a visitor who does not have one. Measured on production 2026-08-24: one
-- click, `created_at == last_sign_in_at`, provider `["google"]`, straight into
-- the app — never told an account was being made, never asked to affirm.
--
-- Recording the affirmation AFTER creation needs no channel at all: the
-- caller is authenticated by then, so an ordinary RPC can write it. The gate
-- becomes a screen the app shows on first entry rather than a hook that has
-- to refuse a signup, which also lets it say the more important thing out
-- loud — that an account has just been created.
--
-- The column is deliberately NOT backfilled. No login has ever affirmed
-- through a recorded control, so treating existing rows as affirmed would be
-- inventing a consent nobody gave; every login affirms once on next entry.

alter table public.members
    add column if not exists age_affirmed_at timestamp with time zone;

CREATE OR REPLACE FUNCTION "public"."age_affirmation_pending"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  -- Whether this login still owes the 18+ affirmation.
  --
  -- True only when there is a members row to record it ON and that row has
  -- never been affirmed. An unauthenticated caller, or one with no members
  -- row, gets FALSE: an affirmation we could not record is one we must not
  -- pretend to hold, and blocking on it would strand the caller in a screen
  -- whose only button cannot succeed.
  select exists (
    select 1 from public.members
    where user_id = auth.uid() and age_affirmed_at is null
  );
$$;

CREATE OR REPLACE FUNCTION "public"."affirm_age"() RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_affirmed_at timestamp with time zone;
begin
  -- Records the 18+ affirmation for the calling login, once.
  --
  -- SECURITY DEFINER because `authenticated` holds no UPDATE policy on
  -- `members` (05_policies.sql grants it self-READ only), and because this
  -- must write exactly one column of exactly one row — the caller's. The
  -- account id is never a parameter: it is `auth.uid()`, so there is no shape
  -- of this call that can affirm on somebody else's behalf.
  --
  -- Idempotent by `coalesce`: a double-submit, a retried request, or a second
  -- tab all return the ORIGINAL timestamp rather than moving it forward. When
  -- this was asked matters — overwriting it would quietly rewrite the record
  -- of consent every time the caller signed in.
  if v_user_id is null then
    raise exception 'affirm_age requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- `clock_timestamp()`, not `now()`: `now()` is the TRANSACTION timestamp, so
  -- two calls inside one transaction return the same value and the
  -- idempotence above becomes unobservable — a test cannot tell `coalesce`
  -- from a plain overwrite, which is exactly what the fail-first check on
  -- supabase/tests/age_affirmation.sql caught. Wall-clock at the moment of
  -- the call is also the more accurate thing to record for a consent.
  update public.members
  set age_affirmed_at = coalesce(age_affirmed_at, clock_timestamp())
  where user_id = v_user_id
  returning age_affirmed_at into v_affirmed_at;

  if v_affirmed_at is null then
    -- handle_new_user() creates this row on every signup, so its absence is
    -- a broken invariant, not a state to paper over.
    raise exception 'affirm_age found no member record for this login'
      using errcode = 'check_violation';
  end if;

  return v_affirmed_at;
end;
$$;

revoke all on function public.age_affirmation_pending() from public, anon;
grant execute on function public.age_affirmation_pending() to authenticated;
grant execute on function public.age_affirmation_pending() to service_role;

revoke all on function public.affirm_age() from public, anon;
grant execute on function public.affirm_age() to authenticated;
grant execute on function public.affirm_age() to service_role;
