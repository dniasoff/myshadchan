-- Backfill member_state for memberships that predate activate_first_context_trigger.
--
-- WHY THIS EXISTS (production incident, recorded so it is never repeated).
-- 20260727223658_context_aware_authorisation.sql created `member_state` and
-- made `current_context_id()` fail closed: it returns NULL unless a
-- member_state row names an account the caller still holds an *active*
-- membership of. Every RLS policy in the schema reads
-- `account_id = public.current_context_id()`, and NULL compares false, so a
-- user with no live member_state row sees nothing at all.
--
-- The only writer of member_state for a *new* membership is
-- `activate_first_context_trigger` (04_triggers.sql), which is AFTER INSERT
-- ON account_members. An AFTER INSERT trigger cannot see rows that already
-- exist. Production had one pre-existing membership row at the time that
-- migration was applied, it therefore never got a member_state row, and the
-- entire application went read-empty: every surface returned HTTP 200 with
-- zero rows. It was repaired by hand with direct SQL against production,
-- which left the repo — and therefore local and CI — not matching
-- production. This migration is that repair, expressed declaratively, so the
-- three environments converge and any future database restored from a
-- pre-Epic-2 backup self-heals instead of coming up silently empty.
--
-- IDEMPOTENT AND CONVERGENT, by construction:
--   * The `not exists (...)` guard is character-for-character the liveness
--     test `current_context_id()` applies (and the one
--     `activate_first_context()` uses to decide whether to act). A user who
--     already resolves to a live context is skipped entirely, so on
--     production today this migration inserts and updates nothing — both
--     users already have valid rows pointing at active memberships.
--   * `on conflict (user_id) do update` also repairs the *stale* variant of
--     the same fault: a member_state row that survives while the membership
--     it names has been archived or deleted. That row is equally fail-closed
--     and equally invisible, and a bare `insert ... do nothing` would leave
--     it broken.
--   * Re-running it is a no-op. On a database built from these migration
--     files there are no account_members rows at all, so it is a no-op there
--     too — which is why it is safe to keep in the permanent migration
--     history rather than being a one-off script.
--
-- CHOICE OF CONTEXT. Lowest `account_members.id` among the user's active
-- memberships — the same `order by am.id limit 1` tiebreak
-- `current_member_id()` uses, and the closest available reading of "their
-- first context", which is exactly what activate_first_context() would have
-- granted had it been able to fire. Filtering on `status = 'active'`
-- explicitly (rather than leaning on the partial unique index
-- `account_members_account_user_active_uq`) keeps this correct for a login
-- holding both an archived and an active membership of the same account.
--
-- This touches DATA only, never schema, so `supabase/schemas/` is unchanged
-- and `supabase db diff` stays clean.

insert into public.member_state (user_id, active_account_id, updated_at)
select distinct on (am.user_id)
  am.user_id,
  am.account_id,
  now()
from public.account_members am
where am.user_id is not null
  and am.status = 'active'
  and not exists (
    select 1
    from public.member_state ms
      join public.account_members live
        on live.user_id = ms.user_id
       and live.account_id = ms.active_account_id
       and live.status = 'active'
    where ms.user_id = am.user_id
  )
order by am.user_id, am.id
on conflict (user_id) do update
  set active_account_id = excluded.active_account_id,
      updated_at = excluded.updated_at;
