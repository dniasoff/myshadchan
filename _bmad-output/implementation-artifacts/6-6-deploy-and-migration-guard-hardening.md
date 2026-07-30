---
baseline_commit: 9a969a0
---

# Story 6.6: Deploy and migration-guard hardening

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the person who has to deploy Epic 6,
I want the migration-safety guard to actually run and the deploy pipeline to
survive a transient upstream 502,
so that the epic's first schema change is protected by the guard that exists
and does not strand production between a migrated database and an old
frontend.

## Why this is a story, and why it is Epic 6's first

Two loose ends came out of Epic 5's deploy. Neither is about a single's
access, so neither belongs as an AC on Stories 6.1–6.5 — folding CI/CD work
into a story about RLS would make its file set overlap `.github/` and
`scripts/`, which no other Epic 6 story declares, and would bury a
production-availability fix inside a permissions review.

They are one story rather than two because they share a single trigger: **the
first Epic 6 migration**. That migration is the first thing that will run
`make check-migration-safety` for real since Epic 5 landed, and it is the
first thing that will exercise the deploy pipeline's post-`db push` window
again.

**Binding delivery order: 6.6 → 6.2 → 6.3 → 6.4 → 6.1 → 6.5.** This is first
because Story 6.2's Task 9 calls `make check-migration-safety`, and with the
fixture as it stands that command fails inside the fixture — on a
`column "notes" of relation "shadchanim" does not exist` error that has
nothing to do with 6.2's diff and would cost a confusing debugging round.

Path-disjoint from every other Epic 6 story: this one touches
`.github/workflows/deploy.yml`, `supabase/tests/migration-data-safety/` and
(optionally) `scripts/ci/`. It touches no file under `src/`,
`supabase/schemas/` or `supabase/migrations/`.

## Acceptance Criteria

1. **`make check-migration-safety` runs green against the current production
   baseline with at least one pending migration.** Today
   `supabase/tests/migration-data-safety/fixture.sql` seeds columns Epic 5
   dropped — `shadchanim.notes` (dropped by
   `20260730093837_shadchan_notes_migration.sql`), `shidduchim.parents_en` /
   `parents_he` (dropped by `20260730011428_shidduch_overview_fields.sql`)
   and `resumes.photos` (dropped by `20260730041150_resume_photos.sql`) —
   none of which exists in the schema the fixture is now run against. The
   fixture is corrected to the post-Epic-5 shape.

2. **The failure is proven to be real before it is fixed, and the fix is
   proven to work.** Captured in the Dev Agent Record: one run of
   `make check-migration-safety` against a throwaway pending migration on the
   *unfixed* fixture, showing the SQL error; one run after, showing
   `migration data-safety guard PASSED`. A guard whose fix was never seen red
   is the same class of artifact as the stale fixture itself.

3. **The guard's own no-op path is not what makes CI green.** The driver
   short-circuits with a pass when `pending.length === 0`
   (`scripts/check-migration-data-safety.mjs:254`), which is why this
   breakage is latent: on `main` with everything deployed, nothing is
   pending, so the fixture never executes. AC-2's "with at least one pending
   migration" is therefore load-bearing — a run that reports "nothing
   pending" does not satisfy this story.

4. **Declarations for already-deployed migrations are retired.**
   `declared-moves.sql` carries three entries (`shidduchim.parents_en/he`,
   `shadchanim.notes`, `resumes.photos`) for columns that no longer exist at
   the baseline. `assert.sql` only consults them for a column that vanished
   *between* baseline and head, so they can never fire again; leaving them
   implies a pending move that is not pending. They are deleted, with the
   file's header comment gaining one line saying that declarations are
   retired once their migration is deployed.

5. **The fixture covers the shapes Epic 6 can break.** It gains a
   `role = 'single'` `account_members` row and a `singles` row linked to it
   via `member_id`, plus rows in the account-scoped tables added since the
   fixture was written that carry data a migration could blank —
   `medical_notes`, `entity_files`, `shidduchim_external_links`,
   `resume_photos`, `identity_signals` (already captured, not seeded
   directly), `subscription` and `ai_usage` — each added to the
   `migration_guard.capture(...)` list. The `singles.member_id` link is the
   specific shape Epic 6 stories 6.1 and 6.5 write to, and the
   `member_state` incident is the precedent for why an unbackfilled column on
   a pre-existing row is the failure mode that reaches production.

6. **The mailer-config step in `deploy.yml` retries a transient failure.** A
   transient Supabase Management API 502 currently fails the whole deploy
   *after* `npx supabase db push` has applied migrations, leaving production
   on new schema under old frontend until someone re-runs the workflow — the
   exact window `deploy.yml`'s own "HONEST LIMIT" comment names as the one
   ordering cannot close. The `📡 Push auth mailer config` step retries up to
   three times with backoff.

7. **The retry distinguishes transient from terminal, and does not soften the
   alarm.** A 5xx, a 429, or a curl transport failure is retried. A **4xx is
   not retried** and still fails the job immediately: the step's existing
   comment states that a 400 here means custom SMTP was removed from the
   project — "an alarm to stop on, not a warning to pass" — and retrying it
   would delay that alarm by two backoff intervals and print it three times.
   After the final attempt the job still fails, with the response body
   echoed exactly as today.

8. **The identically-shaped step immediately before it is covered too.**
   `📡 Enable the invite-signup Auth Hook (before_user_created)` is the same
   scoped Management API PATCH, in the same post-`db push` window, currently
   a bare `curl -sSf` with no retry and no response capture. It gets the same
   treatment. Retry logic is written **once** and shared by both steps — two
   inline copies of the same loop is the DRY violation this AC exists to
   prevent.

9. **Nothing else about the deploy pipeline changes.** No new secret, no
   `supabase config push` (which would overwrite the hosted project's real
   `site_url`/redirect allow-list with this repo's localhost dev values — the
   trap both steps' comments already document), no change to `needs:`
   ordering, no change to the `-o /dev/null` secret-redaction on the hook
   step's output, no change to the orphaned-edge-function reconciliation, and
   no change to the Vercel deploy-hook gate.

## Tasks / Subtasks

- [x] **Task 1 — Reproduce the fixture failure** (AC: 2, 3)
  - [x] Create a throwaway pending migration (e.g. a no-op
        `select 1;` file with a future timestamp) so `partitionMigrations()`
        reports something pending, then run
        `STACK_ID=<1-6> STACK_OWNER=<label> make check-migration-safety`.
        Capture the output. Expected: the run gets past "resetting to
        baseline" and fails inside `fixture.sql`.
  - [x] Record the exact error in the Dev Agent Record → Debug Log
        References. Delete the throwaway migration afterwards; it must not
        appear in the commit.

- [x] **Task 2 — Correct the fixture to the post-Epic-5 schema** (AC: 1, 5)
  - [x] `supabase/tests/migration-data-safety/fixture.sql`:
    - `insert into public.shadchanim (...)` — drop the `notes` column and its
      value.
    - `insert into public.shidduchim (...)` — replace `parents_en`/
      `parents_he` with `father_en`, `father_he`, `mother_en`, `mother_he`.
      **Keep the five documented shapes**, translated: the two production
      shapes become populated father+mother pairs; the no-separator case
      becomes father-only with a null mother (which is what 5.2's backfill
      produced); the Hebrew-only case becomes `father_he`/`mother_he`; the
      control row stays empty. The comment block above them is rewritten to
      describe what the five rows now prove, not what they proved about a
      column that no longer exists.
    - `insert into public.resumes (...)` — drop the `photos` column and its
      `'[]'::jsonb` value.
  - [x] Add the Epic 6 shapes (AC-5): a second `auth.users` row, an
        `account_members` row with `role = 'single'`, and a `singles` row
        whose `member_id` points at it. Seed `medical_notes`, `entity_files`,
        `shidduchim_external_links`, `resume_photos`, `subscription` and
        `ai_usage` with one row each, with fixed ids in the same
        `9000001`-style band.
  - [x] `resume_photos` and `entity_files` carry storage-path check
        constraints (`resume_photos_storage_path_scope_check`,
        `entity_files_storage_path_scope_check`) requiring the path to begin
        with `account_id::text || '/'` — seed paths that satisfy them, or the
        fixture fails on its own inserts.
  - [x] Extend the `migration_guard.capture(...)` list at the bottom to cover
        every newly-seeded table. `capture()` snapshots whole rows as jsonb
        keyed by `id`, so every table it names must have an `id` column —
        all of the above do.
  - [x] Do **not** widen `migration_guard.expected_rewrites`. It is empty by
        design: a rewrite of pre-existing data has to be argued for in
        writing, per the file's own comment.

- [x] **Task 3 — Retire the deployed declarations** (AC: 4)
  - [x] `supabase/tests/migration-data-safety/declared-moves.sql`: delete the
        three `column_moves`/`discarded_columns` blocks for 5.2, 5.9 and 5.4.
        Their migrations are deployed; the columns are not in the baseline
        schema, so nothing in `assert.sql` can ever reach them again.
  - [x] Add one line to the file's header explaining the lifecycle: a
        declaration is written when its migration is pending and removed once
        that migration is deployed, so the file always reads as "what the
        pending migrations claim", never as an archaeological record.
  - [x] The file must remain valid SQL when it contains no `insert`
        statements at all (that is its steady state between epics) — verify
        by running the guard with an empty declarations file.

- [x] **Task 4 — Prove the fix** (AC: 1, 2, 3)
  - [x] Re-create a throwaway pending migration and re-run
        `make check-migration-safety`. Expected: `migration data-safety guard
        PASSED — N seeded row(s) across M table(s) survived intact.` Capture
        it in the Debug Log References beside Task 1's failure.
  - [x] Sanity-check the guard still *catches* something: temporarily point
        the throwaway migration at a destructive statement (e.g. `alter table
        public.shadchanim drop column responsiveness;`) and confirm the guard
        reports `COLUMN DROPPED WITH DATA`. Revert. Without this, a fixture
        that seeds nothing useful would also report PASSED.
  - [x] Delete the throwaway migration. Stop the stack (`make stop`) when
        done — `STACK_ID` 1-6, never 0, and `make start-app-e2e` rather than
        `make start-e2e-ci`.

- [x] **Task 5 — Share one retry helper between the two PATCH steps** (AC: 6, 7, 8)
  - [x] Add `scripts/ci/patch-supabase-auth-config.sh`: takes a path to a
        JSON payload file, PATCHes
        `https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_ID/config/auth`,
        and returns non-zero on terminal failure. A shell script rather than
        two inline `bash` blocks so the logic exists once (AC-8) and can be
        read and reviewed on its own.
  - [x] Behaviour:
    - capture the HTTP status with `-w '%{http_code}'` and the body to a
      temp file (never to stdout — a successful PATCH returns the whole auth
      config, 242 keys including an unmasked `smtp_pass` and
      `external_google_secret`, which GitHub does not know to mask; the
      existing `-o /dev/null` / `-o /tmp/...` handling exists for exactly
      this reason and must be preserved);
    - 2xx → success;
    - 5xx, 429, or curl transport failure (non-zero exit) → retry, up to 3
      attempts total, with a short backoff (e.g. 5s then 15s);
    - 4xx → **fail immediately**, no retry, echoing the same
      `::error::` message and the first 2000 bytes of the body the step
      prints today;
    - after the final failed attempt → exit non-zero with the same message
      shape, plus the attempt count.
  - [x] Rewrite the two steps to call it:
    - `📡 Enable the invite-signup Auth Hook (before_user_created)` — build
      its two-key payload with `jq -n` into a temp file, then call the
      script. Preserve the step's existing comment block explaining why this
      is a scoped PATCH and not `supabase config push`.
    - `📡 Push auth mailer config (config.toml + templates → hosted)` — keep
      its `awk`-based `read_key` extraction and `jq -n --rawfile` payload
      build exactly as they are (the repo stays the single source of truth
      for subject and template body), and replace only the `curl` invocation
      with the script call. Keep the `$GITHUB_STEP_SUMMARY` line.
  - [x] Keep both steps' `if: ${{ env.IS_SUPABASE_CONFIGURED }}` guards and
        their positions in the job unchanged (AC-9).
  - [x] Update the mailer step's comment to state the new behaviour in one
        sentence: transient failures are retried three times; a 400 still
        fails the deploy immediately because it means SMTP was removed.

- [x] **Task 6 — Verify the workflow** (AC: 6, 7, 8, 9)
  - [x] `shellcheck scripts/ci/patch-supabase-auth-config.sh` (or the repo's
        equivalent lint) and `bash -n` on the file.
  - [x] Exercise the script's three branches locally against a stub endpoint
        (a local `python3 -m http.server`-style responder, or `SUPABASE_API_BASE`
        overridable for tests) — 200 first try, 502 twice then 200, and 400
        once. Record the three outcomes in the Debug Log References. Do not
        exercise them against the real project.
  - [x] Diff `.github/workflows/deploy.yml` and confirm nothing outside the
        two steps changed — in particular the `needs:` graph, the
        `trigger-frontend` job and the orphaned-function reconciliation are
        byte-identical.
  - [x] `make typecheck && npm run lint && make test` — none of them should
        be affected, which is itself the check that this story stayed in its
        lane.

## Dev Notes

### Why a stale fixture is worse than no fixture

`make check-migration-safety` exists because two migrations reached or nearly
reached production having passed every other gate:
`20260729095558_backfill_member_state.sql` (an AFTER INSERT trigger with no
backfill, which blanked production — HTTP 200, zero rows, every surface) and
`20260730011428_shidduch_overview_fields.sql` (which would have destroyed 24
rows of parent data and was caught only at deploy pre-flight). Every other
local gate — six clean `db diff` runs included — sees an **empty** table when
a `drop column` runs, because `supabase db reset` applies migrations before
seeding.

A guard with a stale fixture is the specific failure this project has hit
repeatedly: the command still exists, still appears in CI, and still reports
green — because it never runs. Nobody notices until the run that matters, and
then the error names a column from two epics ago rather than the migration
under review. AC-3 is written the way it is because "CI is green" was, at the
time of writing, evidence of nothing.

### Why the fixture gains the `single` shapes

Epic 6 writes to `singles.member_id` (6.1's `accept_invite()` link, 6.5's
`add_persona('single')` path) and adds policies keyed on
`account_members.role = 'single'`. A future migration that recreates
`account_members` or narrows `singles` would meet a fixture that has never
contained either shape, and would pass. Seeding them costs six lines and
makes the guard cover the epic it is guarding.

### Why the retry is bounded and status-aware

The failure mode this closes is narrow: a transient upstream 502 on the
Supabase Management API, *after* `db push` succeeded, which reds the job and
therefore blocks `deploy-workers` and `trigger-frontend` (both `needs:` it).
Production is then running new schema under the previous frontend build until
a human re-runs the workflow. `deploy.yml`'s own comment on the
`trigger-frontend` job already names this window as the half that ordering
cannot close and that only expand/contract migrations survive — this story
does not fix that; it removes the most likely cause of the window being
entered unnecessarily.

An unbounded or status-blind retry would be worse than none. The step's 400
is a real alarm ("custom SMTP was removed from the project"), and a retry
loop that swallowed it into three identical error blocks two backoffs apart
would train the reader to skim past it. Three attempts, transient-only, is
the smallest change that fixes the observed failure without weakening the
observed signal.

### Why a script rather than two inline blocks

Both steps PATCH the same endpoint with the same auth header and the same
secret-redaction requirement, and both are in the same window. Inlining the
retry twice would be the third copy of that curl invocation in one file. One
script, two callers, is DRY, is `shellcheck`-able, and is testable against a
stub — which AC/Task 6 requires, because a retry loop that has never been
seen retry is not a retry loop.

### What this story does not decide

- **Expand/contract migration discipline.** The remaining half of the deploy
  window — new schema under old frontend for the duration of the Vercel build
  — is closed only by backward-compatible migrations, which is a standing
  requirement, not a workflow change.
- **Whether the mailer settings belong in `config.toml` at all.** The three
  numeric settings (`mailer_otp_length`, `mailer_otp_exp`,
  `rate_limit_email_sent`) have no home there because the CLI does not model
  them; that is documented in the step and unchanged here.
- **Anything about the `attachments` bucket, edge-function reconciliation or
  the Vercel gate.** All are working as designed.

### Testing standard

This story has no unit tests to write in the repo's normal sense — its
subject is CI configuration and a SQL fixture. Its evidence is therefore
*captured runs*, recorded in the Dev Agent Record: the guard red, the guard
green, the guard catching a real destructive statement, and the retry
script's three branches. Per `.claude/rules/testing.md`'s spirit, a check
that has not been seen fail is not a check.

Stack discipline per `.claude/rules/parallel-ownership.md`: `STACK_ID` 1-6
(never 0) plus `STACK_OWNER`, `make start-app-e2e` never
`make start-e2e-ci`, stop the stack afterwards. Supabase CLI calls need
`DBUS_SESSION_BUS_ADDRESS=/dev/null`.

### Project Structure Notes — the true file set

- `.github/workflows/deploy.yml` (two steps rewritten; nothing else)
- `scripts/ci/patch-supabase-auth-config.sh` (new)
- `supabase/tests/migration-data-safety/fixture.sql`
- `supabase/tests/migration-data-safety/declared-moves.sql`
- `supabase/tests/migration-data-safety/assert.sql` — **unchanged**; nothing
  here is specific to one migration and this story must not make it so
- `scripts/check-migration-data-safety.mjs` — **unchanged** expected; if the
  driver genuinely needs a change (e.g. the declarations file must tolerate
  being empty), that is a one-line fix with a comment citing this story
- `makefile` — unchanged (`check-migration-safety` already exists at `:227`)

No file under `src/`, `supabase/schemas/` or `supabase/migrations/` is
touched. No new npm dependency. No new repository secret.

### References

- [Source: .claude/rules/parallel-ownership.md] — stack ids, commit
  mechanism, path-disjointness.
- [Source: doc/src/content/docs/developers/migrations.mdx] — "The empty-table
  trap", the documented rationale for the guard this story repairs.
- [Source: AGENTS.md] — `db diff` never re-emits `security_invoker`, grants,
  or storage bucket rows; the declarative-schema workflow the guard sits
  beside.
- Current code, all verified for this refresh:
  `scripts/check-migration-data-safety.mjs:254` (the `pending.length === 0`
  short-circuit that makes the breakage latent), `:50-84`
  (`migrationVersions`/`partitionMigrations`);
  `supabase/tests/migration-data-safety/fixture.sql` (the `shadchanim.notes`,
  `shidduchim.parents_en/he` and `resumes.photos` inserts);
  `supabase/tests/migration-data-safety/declared-moves.sql` (the three
  now-deployed declarations);
  `.github/workflows/deploy.yml` (the `📡 Enable the invite-signup Auth Hook`
  and `📡 Push auth mailer config` steps, both after `📡 Push supabase
  migrations`); `.github/workflows/check.yml:134-175` (the
  `migration-data-safety` job and its `--base-ref` derivation);
  `makefile:227-228`.

## Dev Agent Record

### Agent Model Used

Claude (Sonnet 5), via the bmad-dev-story workflow. Stack `STACK_ID=1`,
`STACK_OWNER=6.6`.

### Debug Log References

**Task 1 — guard RED on the unfixed fixture.** Throwaway pending migration
`99999999999999_guard_throwaway.sql` (`select 1;`), then
`STACK_ID=1 STACK_OWNER=6.6 make check-migration-safety`:

```
[2/4] seeding production-shaped rows and snapshotting them
psql:/home/daniel/repos/myshadchan/supabase/tests/migration-data-safety/fixture.sql:155: ERROR:  column "notes" of relation "shadchanim" does not exist
LINE 1: ....shadchanim (id, account_id, name, name_he, location, notes)
                                                                 ^
migration data-safety guard: Command failed: psql -v ON_ERROR_STOP=1 --quiet -d postgresql://postgres:postgres@127.0.0.1:54352/postgres -f .../fixture.sql
make: *** [makefile:228: check-migration-safety] Error 1
```

Exactly the column AC-1 names — confirms the fixture failure is real and
not hypothetical. Throwaway migration deleted immediately after.

**Task 4 — guard GREEN after the fix.** Fixture corrected (Task 2),
declarations retired (Task 3, now zero `insert` statements — this run is
also the "empty declarations file" verification Task 3's third bullet
asks for), throwaway migration re-created, same command:

```
[3/4] applying the 1 pending migration(s)
[4/4] asserting the seeded data survived
psql:.../assert.sql:202: NOTICE:  migration data-safety guard PASSED — 32 seeded row(s) across 19 table(s) survived intact.
...
migration data-safety guard PASSED.
```

19 tables = the 13 original + the 6 new Epic-6/account-scoped captures
(`resume_photos`, `medical_notes`, `shidduchim_external_links`,
`entity_files`, `subscription`, `ai_usage`). 32 rows matches two
`account_members`/`auth.users`/`members` rows (parent + single), five
`shidduchim`, and one row each of the other seeded tables plus
`identity_signals`.

**Task 4 — guard still CATCHES a real destructive statement.** Temporarily
pointed the throwaway migration at
`alter table public.shadchanim drop column location;` (`location` is
seeded non-empty, `'Lakewood'`, unlike `responsiveness` which the story's
own example names but which the fixture never seeds a value for):

```
psql:.../assert.sql:202: ERROR:  migration data-safety guard FAILED — 1 problem(s):
  - COLUMN DROPPED WITH DATA: public.shadchanim.location held a non-empty value on 1 of 1 pre-existing row(s) and was dropped with no destination declared. Add a row to migration_guard.column_moves (supabase/tests/migration-data-safety/declared-moves.sql) saying where that data went, and backfill it in the migration BEFORE the drop.
```

Reverted; throwaway migration deleted; stack stopped
(`make stop-supabase-e2e STACK_ID=1`).

No one-line fix to `scripts/check-migration-data-safety.mjs` was needed:
the Task-4 PASS run above already ran with a zero-`insert` declarations
file end to end (`psql -f` on a comment-only file is valid SQL and a
no-op), so the driver already tolerates it. Left unchanged, per the
story's own scope note.

**Task 6 — retry script's branches against a local stub** (Python
`http.server`-based responder, `SUPABASE_API_BASE` pointed at
`127.0.0.1:<port>`, never the real project):

| Scenario | Requests received | Wall time | Exit | Message |
|---|---|---|---|---|
| 200 first try | 1 | 0.05s | 0 | (none — success) |
| 502, 502, 200 | 3 | 20.07s (5s + 15s backoff) | 0 | (none — success) |
| 400 once | 1 (no retry) | 0.05s | 1 | `::error::probe rejected — if this is a 400, custom SMTP was removed from the project` + body |
| always-5xx (bonus, exhausts retries) | 3 | 20.08s | 1 | `::error::probe rejected (after 3 attempts)` + body |

`shellcheck scripts/ci/patch-supabase-auth-config.sh` and
`bash -n scripts/ci/patch-supabase-auth-config.sh`: both clean, no
findings.

`git diff -- .github/workflows/deploy.yml`: confirmed only the two PATCH
steps' `run:`/comment blocks changed; `needs:`, `trigger-frontend`, the
orphaned-function reconciliation and the `deploy-workers` matrix are
byte-identical.

`make typecheck`, `npm run lint` (eslint + prettier), `npx vitest run`
(211 files / 2198 tests), `make build`, `node scripts/check-suppressions.mjs`,
`node scripts/check-retired-names.mjs`,
`node scripts/check-route-convention.mjs`,
`node scripts/check-tailwind-arbitrary-var.mjs`, `make test STACK_ID=1`
(same 211/2198), and `supabase db diff --local` (twice, both
"No schema changes found") all pass. `npx prettier --check .` (the bare
default-glob form, distinct from `make lint`'s narrower
`--config ./.prettierrc.json` glob) flags the same 16 pre-existing files —
including `deploy.yml` and `check.yml`, neither of which is in the
narrower glob `make lint` enforces — before and after this diff
(confirmed via `git stash`); this story introduces no new entry in that
list.

### Completion Notes List

- Fixed `supabase/tests/migration-data-safety/fixture.sql` to the
  post-Epic-5 schema: `shadchanim.notes` and `resumes.photos` dropped from
  their inserts; `shidduchim.parents_en/he` replaced by
  `father_en/he`/`mother_en/he` across all five documented shapes (AC-1).
- Added the Epic 6 shapes (AC-5): a second `auth.users` row, an
  `account_members` row with `role = 'single'` on the same household
  account, and the existing `singles` row's `member_id` now points at it —
  the exact link 6.1's `accept_invite()` and 6.5's `add_persona('single')`
  write to. Seeded `resume_photos`, `medical_notes`,
  `shidduchim_external_links`, `entity_files`, `subscription` and
  `ai_usage` (one row each, `9000001`-band ids, storage-path check
  constraints satisfied), and added all six to `migration_guard.capture()`.
  `expected_rewrites` left empty, as instructed.
- Retired the three deployed `declared-moves.sql` entries (5.2, 5.9, 5.4)
  and added the lifecycle line to the header; the file's steady state is
  now zero `insert` statements, verified to run cleanly (AC-4).
- Proved the failure was real (guard red on the unfixed fixture, Task 1)
  and the fix works (guard green, Task 4), and that the guard still
  catches a genuine destructive drop (Task 4) — all three captured above,
  satisfying AC-2/AC-3's "never seen fail" standard.
- Added `scripts/ci/patch-supabase-auth-config.sh`: a bounded 3-attempt,
  status-aware retry (2xx success; 5xx/429/curl-transport-failure retried
  with 5s/15s backoff; any other 4xx fails immediately with no retry) for
  the shared `/config/auth` scoped Management-API PATCH, with the response
  body captured to a temp file and never printed on success (AC-6/7/8).
  Verified against a local stub across all three required branches plus
  the exhausted-retry path.
- Rewired both `deploy.yml` PATCH steps
  (`📡 Enable the invite-signup Auth Hook` and `📡 Push auth mailer config`)
  to call the shared script, preserving each step's existing
  scoped-PATCH-not-`config push` rationale, the mailer step's
  `awk`/`jq --rawfile` extraction, the `$GITHUB_STEP_SUMMARY` line, and
  both steps' `if:`/position — confirmed via diff that nothing else in the
  file changed (AC-9).
- `scripts/check-migration-data-safety.mjs` needed no change: verified
  live that the driver already tolerates a zero-`insert` declarations
  file. Left untouched, as the story's scope note anticipates either
  outcome.
- `assert.sql` and `makefile` untouched, as required.

### File List

- `.github/workflows/deploy.yml` (modified)
- `scripts/ci/patch-supabase-auth-config.sh` (new)
- `supabase/tests/migration-data-safety/fixture.sql` (modified)
- `supabase/tests/migration-data-safety/declared-moves.sql` (modified)

## Change Log

- 2026-07-30: Story 6.6 implemented — migration-safety guard fixture
  corrected to the post-Epic-5 schema and extended with Epic 6's `single`
  shapes and the newer account-scoped tables; deployed `declared-moves.sql`
  entries retired; shared retry helper added for the deploy pipeline's two
  post-`db push` Management-API PATCH steps. Status set to `review`.
