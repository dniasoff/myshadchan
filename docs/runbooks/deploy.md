# Deploy Runbook

## What the deploy does

The `🚀 Deploy` workflow is serialized per branch with
`cancel-in-progress: false`. GitHub keeps only the newest pending run in a
concurrency group, so rapid merges can collapse into the newest run; that run
always deploys the current head of `main`.

When a push changes `supabase/migrations/` or `supabase/schemas/`, the workflow
first creates a disposable local Supabase stack and runs the non-empty-table
migration safety check against the push's `before` commit. If the base cannot
be resolved, the preflight fails closed by running with the fallback behavior
of `check-migration-data-safety.mjs`.

The same change scope takes a pre-mutation backup through the private R2
bucket. The shared `.github/actions/supabase-backup` action writes roles,
schema and data as three gzipped files under a timestamped prefix. A failed or
empty dump, or a failed R2 upload, stops the deploy before the Auth Hook patch
or `db push`. R2 keeps the prefixes for 30 days; restore order and access
instructions are in [database-restore.md](database-restore.md).

The Supabase CLI version is read from `package.json` and passed to
`supabase/setup-cli`; deploy steps call that installed binary. The current pin
is 2.111.0 while the upstream `supabase link` regression remains unresolved.

## Smoke and failure handling

After the Supabase, Workers and Vercel jobs finish, the final smoke job checks
that all three job results succeeded, the seven Workers in the matrix are
present in Cloudflare and answer `/health`, Supabase Auth health returns 200,
and `APP_ORIGIN` returns 200. A failed check makes the workflow red and writes
the observed provider results and recovery links to the run summary. It does
not attempt an automatic rollback; pause further deploys and follow
[failed-deploy.md](failed-deploy.md) and [database-restore.md](database-restore.md).

## Safe rollback

Do not run `supabase db reset` or manually re-run a production migration. For a
code-only rollback, revert the bad commit on `main` and let the serialized
workflow deploy the new head after the required checks pass. For a migration
or data incident, stop deploys, preserve the run and R2 prefix, and use the
database restore runbook with Captain/Deploy approval.
