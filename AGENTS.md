# AGENTS.md

## Project Overview

Atomic CRM is a full-featured CRM built with React, shadcn-admin-kit, and Supabase. It provides contact management, task tracking, notes, email capture, and deal management with a Kanban board.

## Development Commands

### Setup
```bash
make install          # Install dependencies (frontend, backend, local Supabase)
make start            # Start full stack with real API (Supabase + Vite dev server)
make stop             # Stop the stack
make start-demo       # Start full-stack with FakeRest data provider
```

### Testing and Code Quality

```bash
make test             # Run unit tests (vitest)
make typecheck        # Run TypeScript type checking
make lint             # Run ESLint and Prettier checks
```

### Building

```bash
make build            # Build production bundle (runs tsc + vite build)
```

### Database Management

The database schema is defined declaratively in `supabase/schemas/` (source of truth). Migrations in `supabase/migrations/` are auto-generated and should generally not be edited directly — but sometimes manual adjustment is needed (e.g., replacing a DROP+CREATE with an ALTER TABLE RENAME for column renames). Function definitions in `02_functions.sql` must use the exact `pg_dump` format (run `npx supabase db dump --local --schema public`) to avoid phantom diffs.

```bash
npx supabase db diff --local -f <name>  # Generate migration from schema changes
npx supabase migration up --local       # Apply migrations locally
make check-migration-safety             # REQUIRED before push — see below
npx supabase db push                    # Push migrations to remote
npx supabase db reset --local           # Reset local database (destructive)
```

#### The empty-table trap (a green migration that erases production)

`db reset` applies migrations to an **empty** database and seeds afterwards,
and `db diff` compares **shapes** — so no other gate in this repo ever runs a
migration against a row. A `drop column` with no backfill, or a resync that
recomputes a derived column from columns that are NULL at that moment, is
green on every local gate and destroys production, because production is the
only place the table is not empty. It has happened twice:
`20260729095558_backfill_member_state.sql` (shipped; blanked production) and
`20260730011428_shidduch_overview_fields.sql` (caught at pre-flight).

`make check-migration-safety` (`STACK_ID=<n>` for your own stack) is the only
check that closes it: it resets a stack to the **last deployed** migration,
seeds production-shaped rows, applies just the **pending** migrations, then
asserts every seeded row still exists, every value in a surviving column is
unchanged, and every column that vanished while holding data has a declared,
verified destination. CI runs the same script against the merge base.

The fix when it goes red is always the same shape, and `db diff` will never
generate it: **`add column` before `drop column`, backfill between them, and
a fail-closed assertion** so a wrong assumption about the data halts the
deploy instead of erasing it. Declare intentional losses in
`supabase/tests/migration-data-safety/declared-moves.sql`.

#### The `--db-url` trap (a diff that reports "no changes", always)

**`supabase db diff --db-url <url>` does not read `supabase/schemas/**` at all.**
It compares a migrations-replay against the target database and prints
`No schema changes found` no matter what the declarative schema says. It is not
a convergence check, and using it as one is a guaranteed false green.

Measured on CLI 2.109.1: with `zzz_probe_column` added to `cron_heartbeat` in
`01_tables.sql`, `db diff --db-url` reported `No schema changes found`; the
scratch-workdir form below reported
`alter table "public"."cron_heartbeat" add column "zzz_probe_column" text;`.

This bites specifically when targeting a **leased stack**, because the obvious
way to aim at one is wrong in the other direction: **`--local` ignores
`STACK_ID`** and always means the shared dev stack on `54322`. `STACK_ID` is
read by the makefile, `vite.config.ts`, `playwright.config.ts`,
`vitest.config.ts` and `scripts/stack-env.mjs` — never by the supabase CLI. An
agent that ran `db diff --local` while holding stack 1 wrote its migration into
the shared dev database and had to hand-revert it.

To diff declaratively against stack N, give the CLI a workdir whose
`config.toml` names that stack's port:

```bash
SCRATCH=$(mktemp -d); cp -r supabase "$SCRATCH/supabase"
perl -0pi -e 's/(\[db\]\n(?:#[^\n]*\n|\n)*port = )\d+/${1}5435N/' "$SCRATCH/supabase/config.toml"
DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --workdir "$SCRATCH" --local
rm -rf "$SCRATCH"
```

Applying a migration is the opposite: `migration up --db-url <url>` **does**
honour the URL, so that one is correct as written.

Before trusting any empty diff, confirm the check can fail — inject a throwaway
column into the scratch copy and watch it appear. An empty diff from a command
that cannot see your schema looks exactly like a converged one.

#### The column-order trap (`db diff` never converges)

If `db diff` emits `drop view` + `create or replace view` for views you did not
touch, on a tree with no pending edit, **do not commit that as a migration** —
it is non-convergent and the next diff reproduces it identically. It also
silently drops `security_invoker = on` and the `06_grants.sql` grants from every
view it rewrites.

The cause is a `create table` block in `supabase/schemas/01_tables.sql` whose
column order no longer matches the database's physical order — `alter table add
column` appends to the tail, `drop column` leaves a hole, and `migra` compares
by ordinal position. Fix it by reordering the declarative block, **never** with
a migration:

```bash
npm run test:unit:db -- column_order   # names any table whose declared order has drifted
```

Full explanation, including the Epic-5 incident that cost a deploy and the two
migration comments that misdiagnose it, is in the `COLUMN-ORDER TRAP` header of
`supabase/schemas/01_tables.sql`. After any fix, run `db diff` **twice** — once
for clean, once for convergence.

### Registry (Shadcn Components)

```bash
make registry-gen     # Generate registry.json (runs automatically on pre-commit)
make registry-build   # Build Shadcn registry
```

## Architecture

### Technology Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Routing**: React Router v7
- **Data Fetching**: React Query (TanStack Query)
- **Forms**: React Hook Form
- **Application Logic**: shadcn-admin-kit + ra-core (react-admin headless)
- **UI Components**: Shadcn UI + Radix UI
- **Styling**: Tailwind CSS v4
- **Backend**: Supabase (PostgreSQL + REST API + Auth + Storage + Edge Functions)
- **Testing**: Vitest

### Directory Structure

```
src/
├── components/
│   ├── admin/              # Shadcn Admin Kit components (mutable dependency)
│   ├── atomic-crm/         # Main CRM application code (~15,000 LOC)
│   │   ├── billing/        # Billing / AI entitlement page
│   │   ├── children/       # Single (candidate) management
│   │   ├── dashboard/      # Dashboard widgets
│   │   ├── inbox/          # Capture inbox ("front door")
│   │   ├── landing/        # Public landing page
│   │   ├── layout/         # App layout components
│   │   ├── login/          # Authentication pages
│   │   ├── misc/           # Shared utilities
│   │   ├── portal/         # Read-only child portal (E7)
│   │   ├── providers/      # Data providers (Supabase + FakeRest)
│   │   ├── references/     # Reference book (calls, diligence)
│   │   ├── reminders/      # Reminders hub (polymorphic tasks)
│   │   ├── root/           # Root CRM component
│   │   ├── members/        # Member (user/profile) management
│   │   ├── settings/       # Settings page
│   │   ├── shadchanim/     # Matchmaker management
│   │   ├── shidduchim/     # Shidduchim pipeline (Kanban)
│   │   ├── tasks/          # Task management
│   │   └── tour/           # Onboarding walkthrough
│   ├── supabase/           # Supabase-specific auth components
│   └── ui/                 # Shadcn UI components (mutable dependency)
├── hooks/                  # Custom React hooks
├── lib/                    # Utility functions
└── App.tsx                 # Application entry point

supabase/
├── functions/              # Edge functions (user management, inbound email)
├── migrations/             # Database migrations (auto-generated, do not edit directly)
└── schemas/                # Declarative schema (source of truth for DB structure)
```

### Key Architecture Patterns

For more details, check out the doc/src/content/docs/developers/architecture-choices.mdx document.

#### Mutable Dependencies

The codebase includes mutable dependencies that should be modified directly if needed:
- `src/components/admin/`: Shadcn Admin Kit framework code
- `src/components/ui/`: Shadcn UI components

#### Configuration via `<CRM>` Component

The `src/App.tsx` file renders the `<CRM>` component, which accepts props for domain-specific configuration:
- `taskTypes`: Task type options
- `logo`, `title`: Branding
- `lightTheme`, `darkTheme`: Theme customization
- `disableTelemetry`: Opt-out of anonymous usage tracking

#### Database Views

Complex queries are handled via database views to simplify frontend code and reduce HTTP overhead. For example, `shidduchim_summary` provides aggregated pipeline data including reference and redt counts.

#### Database Triggers

User data syncs between Supabase's `auth.users` table and the CRM's `members` table via triggers (see `supabase/schemas/04_triggers.sql`).

#### Edge Functions

Located in `supabase/functions/`:
- User management (creating/updating users, account disabling)
- Inbound email webhook processing

#### Data Providers

Two data providers are available:
1. **Supabase** (default): Production backend using PostgreSQL
2. **FakeRest**: In-browser fake API for development/demos, resets on page reload

When using FakeRest, database views are emulated in the frontend. Test data generators are in `src/components/atomic-crm/providers/fakerest/dataGenerator/`.

#### Filter Syntax

List filters follow the `ra-data-postgrest` convention with operator concatenation: `field_name@operator` (e.g., `first_name@eq`). The FakeRest adapter maps these to FakeRest syntax at runtime.

## Development Workflows

### Path Aliases

The project uses TypeScript path aliases configured in `tsconfig.json` and `components.json`:
- `@/components` → `src/components`
- `@/lib` → `src/lib`
- `@/hooks` → `src/hooks`
- `@/components/ui` → `src/components/ui`

### Adding Custom Fields

When modifying an entity's data structures (e.g. `shidduchim`, `references`):
1. Edit the relevant schema file in `supabase/schemas/` (table in `01_tables.sql`, views in `03_views.sql`, etc.)
2. Generate a migration: `npx supabase db diff --local -f <name>`
3. Apply it: `npx supabase migration up --local`
4. If using FakeRest, update data generators in `src/components/atomic-crm/providers/fakerest/dataGenerator/`
5. Don't forget to update the related summary view (e.g. `shidduchim_summary`, `references_summary`) in `03_views.sql`
6. Don't forget the merge logic if the entity supports merging (e.g. `merge_references()`)
7. If the migration added or dropped a column, reorder the `create table` block in `01_tables.sql` to the database's physical order — see "The column-order trap" above, and `npm run test:unit:db -- column_order`

### Git Hooks

- Pre-commit: Automatically runs `make registry-gen` to update `registry.json`

### Accessing Local Services During Development

- Frontend: http://localhost:5173/
- Supabase Dashboard: http://localhost:54323/
- REST API: http://127.0.0.1:54321
- Storage (attachments): http://localhost:54323/project/default/storage/buckets/attachments
- Inbucket (email testing): http://localhost:54324/

## Important Notes

- The codebase is intentionally small (~15,000 LOC in `src/components/atomic-crm`) for easy customization
- Modify files in `src/components/admin` and `src/components/ui` directly - they are meant to be customized
- Unit tests can be added in the `src/` directory (test files are named `*.test.ts` or `*.test.tsx`)
- User deletion is now supported via the account deletion workflow (see Story 14.2)
- Filter operators must be supported by the `supabaseAdapter` when using FakeRest
