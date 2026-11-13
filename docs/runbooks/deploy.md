# Deploy Runbook

## What the deploy does

The `🚀 Deploy` workflow uses one production-wide concurrency group with
`cancel-in-progress: false`. GitHub keeps only the newest pending run in a
concurrency group, so rapid merges can collapse into the newest run; that run
always deploys the current head of `main`. A manual dispatch is guarded to
`main` and uses the same lock, so it cannot deploy an arbitrary branch or race
with an automatic deploy.

The first job validates every deploy secret, links the hosted project with the
pinned CLI, reads the hosted migration history, and runs `db push --dry-run`.
It derives the last remotely applied version from that history. If any
migrations are pending, it creates a disposable local Supabase stack, runs the
non-empty-table safety check against that exact hosted baseline, and then takes
the private-R2 backup. A missing or malformed hosted history, an unavailable
baseline, or any dry-run error fails closed: there is no green skip and no
hosted mutation. The same preflight is used by a `main`-only
`workflow_dispatch`, which is the safe manual re-run path.

The same change scope takes a pre-mutation backup through the private R2
bucket. The shared `.github/actions/supabase-backup` action writes roles,
schema and data as three gzipped files under a timestamped prefix. A failed or
empty dump, or a failed R2 upload, stops the deploy before the Auth Hook patch
or `db push`. R2 keeps the prefixes for 30 days; restore order and access
instructions are in [database-restore.md](database-restore.md).

The Supabase CLI version is read from `package.json` and passed to the verified
`supabase/setup-cli` v3.2.0 commit; deploy steps call that installed binary.
The current CLI pin is 2.111.0 while the upstream `supabase link` regression
remains unresolved. Lift it only after a non-production linked-project dry run
proves that the hosted migration history is read correctly.

## How to ship

Merge only after the required PR checks are green, including database schema
convergence and migration data-safety against the merge base. The push to
`main` queues the deploy; rapid merges may collapse to the newest pending run,
which always deploys the current head. Use `workflow_dispatch` to re-run a
failed deploy after fixing its cause. The preflight and backup must succeed
before any hosted mutation; Workers and the Vercel hook follow Supabase.

## Smoke and failure handling

After the Supabase, Workers and Vercel jobs finish, the final smoke job checks
that all three job results succeeded, the seven Workers in the matrix are
present in Cloudflare and answer `/health`, Supabase Auth health returns 200
with the publishable key, and `APP_ORIGIN` follows redirects and returns 200.
The Vercel hook is required. The frontend build emits `/version.json` from
Vercel's `VERCEL_GIT_COMMIT_SHA`; the smoke polls it with a bounded deadline
and requires the deployed commit to equal the workflow SHA. If Vercel omits
that variable, the file is labelled `identity: unverified` and the summary
says that identity was not verified. A failed check makes the workflow red and
writes the observed provider results and recovery links to the run summary.
It does not attempt an automatic rollback; pause further deploys and follow
[failed-deploy.md](failed-deploy.md) and [database-restore.md](database-restore.md).

### Enabling outbound email

Outbound email remains off until Captain/ops has confirmed the Resend sender,
plan and retention posture. The controlled switch-on sets the existing Worker
secret `OUTBOUND_EMAIL_REPLY_TO` and the Vercel build variable
`VITE_OUTBOUND_EMAIL_REPLY_TO` to the same approved address, without committing
the address. It also sets the existing Worker variable
`OUTBOUND_EMAIL_ACCOUNT_IDS` to the explicitly approved account ids and turns
`OUTBOUND_EMAIL_ENABLED` on. The authenticated email Worker `/config` response
is the runtime source of truth; the frontend checks that its build value
exactly matches the Worker value and keeps the Email action unavailable on any
mismatch or unset value. `OUTBOUND_EMAIL_GLOBAL_DAILY_CAP` defaults to 40 and
may only be lowered or raised deliberately with the shared Resend plan budget
in view. The global count-then-send check is intentionally a best-effort
cross-account budget rather than an atomic reservation: 40 leaves 60 sends of
the Resend Free plan's 100/day allowance for reminders and a bounded amount of
concurrency overshoot. Treat the cap as an operational guard, not a hard
provider ceiling; a hard ceiling would require a durable atomic reservation
follow-up before changing this policy.

## Safe rollback

Do not run `supabase db reset` or manually re-run a production migration. A git
revert does not undo a migration that already ran; it creates a new commit and
still leaves the applied schema in place. For a migration or data incident,
stop deploys, preserve the run and R2 prefix, and use a forward-fix migration
or the database restore runbook with Captain/Deploy approval. For a code-only
rollback, revert the bad commit on `main` and let the serialized workflow
deploy the new head after the required checks pass.
