- source_spec: `_bmad-output/implementation-artifacts/spec-realistic-demo-showcase.md`
  summary: Make persistent demo seeding atomic or add complete compensating cleanup so a failed run can be retried safely.
  evidence: `seed_demo` performs many database and storage writes before setting the demo flag, while its existing non-empty guard rejects a retry after any partial failure.

- source_spec: `_bmad-output/implementation-artifacts/spec-realistic-demo-showcase.md`
  summary: Serialize persistent demo seeding per account to prevent two simultaneous empty-account checks from both proceeding.
  evidence: The existing check-then-seed sequence has no database advisory lock or equivalent account-scoped mutex, so concurrent requests can duplicate rows and storage objects.

- source_spec: `_bmad-output/implementation-artifacts/spec-sign-in-no-account-recovery.md`
  summary: Bind Google signup authorization to the explicit signup transaction so a stale signup_intents row cannot authorize account creation from the returning-user Google sign-in button.
  evidence: Supabase OAuth has no shouldCreateUser=false option and the before_user_created hook sees the Google provider/user but not this client-side sign-in marker; a pending email-keyed signup_intents row is therefore consumed before the callback can classify the result.
