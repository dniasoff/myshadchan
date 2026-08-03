# A Guard's PASS Is Only Evidence If Someone Has Watched It FAIL

## The incident

Story 8.2 (`7e0dadc`) made `connections.proposed_by_account_id` and
`connections.household_account_name` `NOT NULL`. The migration data-safety
guard's own fixture (`supabase/tests/migration-data-safety/fixture.sql`)
seeds a `connections` row from Story 7.1 that predates both columns, and
nobody updated it. From that commit forward, `make check-migration-safety`
never got past its own setup step: `psql` hit a `NOT NULL` violation loading
the fixture, before a single pending migration had been applied.

That is a real, loud, non-zero-exit failure — `psql -v ON_ERROR_STOP=1`
does its job. What made it invisible was everything around it:

- The failure message was `migration data-safety guard: Command failed:
  psql ...`, textually indistinguishable from the ONE finding this guard
  exists to make ("the pending migrations destroy data"). Nothing in the
  output said "this is setup, not a finding" or "nothing was verified."
- The failure happened in [2/4] (seeding), which was not wrapped in the
  driver's only `try/catch` — that block covered `[4/4]` alone. So the
  script also skipped "restoring the stack to head," leaving whatever ran
  next against a stack frozen at the bare baseline schema.
- Four stories in a row — 8.3, 8.4, 8.5, and every one of Epic 9's — either
  never looked past a red exit code that looked routine, or (Stories 9.1 and
  9.3, by their own commit messages) believed they had "seeded the
  migration-safety fixture" because they added correct, well-guarded
  `to_regclass` blocks lower in the file — blocks that could never run,
  because the script never got past line ~511 to reach them. The guard gave
  **zero signal on every migration since Story 8.2**, through the whole of
  Epic 8's deploy and the whole of Epic 9, and nobody noticed until this was
  reproduced deliberately against `origin/main` (`3032e14`) — proving the
  gap pre-dated Epic 9 entirely.

Separately, and found while fixing this: the fixture's list of tables to
protect was hand-enumerated (`select migration_guard.capture('table');`,
one line per table, ~30 lines). It had already gone stale once before this
incident — `invites` was missing through the whole of Epic 6 — and at the
time of this fix it was missing **seven** tables outright:
`configuration`, `inbox_items`, `date_records`, `shidduch_schools`,
`connection_invites`, `share_links`, `share_access_log`. Three of those
(`inbox_items`, `shidduch_schools`, `connection_invites`) have real UI
read/write paths — real production data this guard was silently not
protecting, with no error of any kind, because nothing ever checked the
list against the schema.

## Why this is the mirror image of `gate-verification.md`

That rule is about a **red** gate: don't write down "pre-existing" without
proving it against the base commit. This is about a gate that reports
**green** (or, here, a gate whose red got waved past four times running):
don't trust a PASS — or a "this doesn't apply to me, it's failing for some
other reason" — without having independently confirmed the guard is
actually exercising what it claims to. Both failures have the same shape: a
belief about a gate's state gets written down and relied on by someone else
without the cheap check that would have disproved it. **If a guard reports
success, check it actually did work.**

Concretely, before trusting any guard's PASS as meaning what it says:

- Has anyone, ever, watched this guard fail on a genuinely bad input? A
  guard nobody has watched fail is not evidence — it might be validating
  nothing, and a construction that always says yes looks identical to a
  working one right up until the day it matters.
- Can the guard's own SETUP fail in a way that looks like — or is worded
  identically to — the finding it exists to report? If yes, that ambiguity
  is a defect in the guard, not a detail to route around at read-time.
- Does a setup failure leave shared state (a database, a stack, a cache)
  dirty for whatever runs next? A guard that fails outward as well as
  inward compounds the damage of being missed once.

## The repair, as a template for the next one

1. **Fixed the immediate gap**: `fixture.sql`'s `connections` INSERT now
   supplies both Story 8.2 columns, plus production-shaped seeds for the
   three previously-unprotected tables with real writers, plus explicit
   `to_regclass`-guarded seeds for `share_links`/`share_access_log`
   (Story 9.5) so that table does not repeat this same gap once its own
   migration deploys.
2. **Closed the class, not just the instance**: the hand-enumerated
   `capture()` list was replaced with a loop over `pg_class` — every base
   table in `public` at the baseline is captured automatically, derived from
   the catalog rather than remembered by hand. A table added in some future
   story is protected from the moment it exists, whether or not that story's
   author knows this fixture exists.
3. **Made "nobody seeded this" loud instead of silent**: a completeness
   check runs after the capture loop and fails the fixture (not silently,
   not later) if any `public` base table has zero captured rows and no
   `migration_guard.empty_by_design` declaration explaining why. That
   declaration form mirrors `column_moves`/`discarded_columns` — a reasoned,
   reviewable claim, not a default.
4. **Added an anti-vacuity floor**: a regression that gutted most of the
   fixture's INSERTs but left the trigger-derived rows (`member_state`,
   `pipeline_transitions`) would still pass the completeness check one row
   at a time, and could still print a technically-true but nearly-vacuous
   PASS. A floor (currently: at least 20 tables and 40 rows captured, well
   below the ~32 tables / ~67 rows this fixture produces today) fails that
   scenario loudly instead.
5. **Made the driver's failure modes distinguishable**: `scripts/check-
   migration-data-safety.mjs` now tags which of `reset` / `seed` / `apply` /
   `assert` failed and prints a phase-specific banner. Only `assert` says
   "the pending migrations destroy data" — `seed` explicitly says setup
   failed, nothing was verified, and this is not a migration-safety
   statement. All four phases now unconditionally restore the stack to head
   before exiting (previously only `assert` did), so a setup failure no
   longer leaves a dirty stack for the next thing that runs against it.

## Proof, not assertion

Fixing a guard and declaring it fixed repeats exactly the mistake this
incident is made of — a claim nobody checked. Before this was considered
done:

- **Green, for real**: `make check-migration-safety` run against Epic 9's
  actual 8 pending migrations, clean — `32 table(s)` / `67 row(s)`
  captured and confirmed intact.
- **Red, for a real finding**: a scratch copy of the repo (never the
  working tree — see `.claude/rules/gate-verification.md`'s "exact command
  shape" for why) with one deliberately destructive migration
  (`alter table medical_notes drop column body`, no backfill, no
  declared-moves entry) added. The guard correctly failed at `[4/4]` with
  `COLUMN DROPPED WITH DATA`, under the `assert` banner, exit 1.
- **Red, reproducing the original bug**: the same scratch technique with
  the fixture's `connections` INSERT reverted to its pre-fix (Story 8.2
  broken) shape, run against the real Epic-8 baseline. The guard failed at
  `[2/4]` under the new `seed` banner — "SETUP FAILED ... nothing was
  verified ... NOT a statement about migration safety" — instead of the old
  undifferentiated `Command failed: psql ...`.
- **Recovery confirmed**: after each scratch run, the real stack (never
  touched by the scratch copy's migrations directly — only its gitignored,
  per-stack `.supabase-e2e-N` workdir) was re-verified clean by re-running
  the real guard against the real tree.

Do this same three-part proof (green on the real case, red on a real
finding, red reproducing whatever silently broke) whenever a guard is
repaired here. A repair that only demonstrates the green case has not shown
the guard can still say no.
