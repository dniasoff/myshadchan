# Deferred work

Reviewed 2026-08-24. Two of the three items below were closed by the official
demo seed lifecycle that shipped in `2a8b066`; the third is still open and is
blocked outside this repository. Nothing here is waiting on a decision.

- source_spec: `_bmad-output/implementation-artifacts/spec-realistic-demo-showcase.md`
  summary: Make persistent demo seeding atomic or add complete compensating cleanup so a failed run can be retried safely.
  evidence: `seed_demo` performs many database and storage writes before setting the demo flag, while its existing non-empty guard rejects a retry after any partial failure.
  status: RESOLVED (2a8b066)
  resolution: A run is now activated only when its manifest matches the frozen
    resource baseline, so a partial seed can never present as complete, and a
    failure runs lease-fenced compensation that removes the whole run before
    returning. Retry is a first-class path: `prepare_demo_onboarding` reopens a
    completed or failed intent, and `20260824064656` discards the husk the
    previous lifecycle retained. Proven by the hosted acceptance harness
    (`scripts/hosted-demo-smoke.mjs`), which runs two full lifecycles plus an
    admin reseed and then verifies the project is empty -- 609 checks green
    against production, including runs where a mid-seed failure was
    compensated and the graph verified gone.

- source_spec: `_bmad-output/implementation-artifacts/spec-realistic-demo-showcase.md`
  summary: Serialize persistent demo seeding per account to prevent two simultaneous empty-account checks from both proceeding.
  evidence: The existing check-then-seed sequence has no database advisory lock or equivalent account-scoped mutex, so concurrent requests can duplicate rows and storage objects.
  status: RESOLVED (2a8b066)
  resolution: The check-then-seed sequence was replaced by a lease. Every
    lifecycle writer (`begin_demo_seed`, `fence_demo_cleanup`,
    `delete_demo_cleanup_rows`, `finalize_demo_seed_cleanup`, the r20/r21
    listing resolver and withdrawal paths) takes a row lock on `demo_runs` and
    compare-and-swaps a lease token plus epoch, and refuses on a stale or
    foreign lease with `clock_timestamp()` expiry rechecked at the atomic
    transition. Concurrency, stale-lease and wrong-operation refusals are
    covered by `supabase/tests/official_demo_r21_activation.sql` (14 checks)
    and `official_demo_r20_listing_resolution.sql`.

- source_spec: `_bmad-output/implementation-artifacts/spec-sign-in-no-account-recovery.md`
  summary: Bind Google signup authorization to the explicit signup transaction so a stale signup_intents row cannot authorize account creation from the returning-user Google sign-in button.
  evidence: Supabase OAuth has no shouldCreateUser=false option and the before_user_created hook sees the Google provider/user but not this client-side sign-in marker; a pending email-keyed signup_intents row is therefore consumed before the callback can classify the result.
  status: OPEN -- blocked upstream, impact bounded
  resolution: Still open, and not fixable in this repository as specified:
    Supabase's OAuth entry point has no `shouldCreateUser` equivalent, and
    `before_user_created` cannot see a client-side marker, so there is no hook
    where the binding could be enforced. Confirmed still open on 2026-08-24 --
    `oauthCallback.ts` does not reference `signup_intents` at all, and
    `741f0f5` ("harden OTP and OAuth recovery") did not touch it.
    What the impact actually is, measured against the live project rather than
    assumed: Google is ENABLED (`external_google_enabled = true`) and signup is
    OPEN (`disable_signup = false`, and `20260804214603_open_signup.sql`
    dropped `check_signup_invite`, leaving only the `check_signup_age` hook).
    So the consequence of a prematurely consumed intent is a misclassified
    signup -- a returning-user button creating an account -- and NOT the bypass
    of an invite gate, because there is no invite gate left to bypass. It is a
    correctness and telemetry defect, not a privilege escalation.
    Revisit if signup is ever closed again: the same defect would then become a
    gate bypass, and would have to be fixed before that change ships.
