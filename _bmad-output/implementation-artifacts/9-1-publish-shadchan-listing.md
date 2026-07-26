# Story 9.1: Publish a shadchan listing

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a shadchan,
I want a professional listing,
so that families can find me.

## Position in Epic 9

**1st of 5.** Epic 9 has no pinned order in `epics.md`; this ordering is this story-writing
pass's own decision, stated so nobody re-derives it differently mid-epic:

`9.1 (this story) → 9.2 (publish a single's listing) → 9.3 (single withdraws / dignity-floor
lock) → 9.4 (public search) → 9.5 (revocable share links)`

**Why 9.1 first:** it creates the `listings` table — the sole anon-readable relation in the
product (AD-1, AD-21) — and every later Epic-9 story depends on that table existing. Shadchan
listings have no manager/subject split (the shadchan is both publisher and subject), so this
story is the simplest possible slice through the new table and de-risks the schema before 9.2
adds the harder, two-party single case.

**This story owns:** the `listings` table itself (full column shape, both `listing_type`
branches), and every RLS policy/grant that concerns `listing_type = 'shadchan'`. It does
**not** touch `listing_type = 'single'` authorization at all — 9.2 adds that as
**additional, separate, named policies** (Postgres combines multiple permissive policies for
the same command with `OR`), so 9.2 never edits a policy this story wrote. See Dev Notes
"Policy ownership map across 9.1–9.3" for the complete table.

**Depends on:**
- **Epic 2** (Story 2.2, Persona and context data model) for `accounts.kind` (`household |
  shadchanus`), `account_members.role` including `'shadchan'`, and `current_context_id()`
  (AD-19) replacing the deleted `current_account_id()`.
- **Epic 8** (Story 8.1, Shadchanus context) for a shadchan actually holding a `shadchanus`-kind
  account to publish from. Without 8.1, there is no account with `kind = 'shadchanus'` for this
  story's RLS to authorize against.

**Must not be confused with:** the existing `public.shadchanim` table. That table is a
**household's own address-book row** about a matchmaker the family works with (name, contacts,
notes) — it survives Epic 1 unchanged and is not touched by this story. This story's listing is
about the **shadchan's own account** (their `shadchanus` context), published by the shadchan
about themselves. A family's private `shadchanim` row is never read by, written to, or exposed
through `listings`.

## Acceptance Criteria

1. **Field-by-field opt-in, nothing published by default.** Given my active context is a
   `shadchanus` account, when I open the "Publish my listing" panel, I see three independent
   toggles — name, area, how to reach — each defaulting **off**. A field I leave off is never
   written to the database (the column is `null`, not an empty string).

2. **Name is the one required field.** Given I have not opted into "name", when I try to
   publish, the action is refused client-side and server-side (a `listings` row for
   `listing_type = 'shadchan'` can never have `shadchan_name is null` — enforced by a CHECK
   constraint, not just UI).

3. **Publishing is idempotent per account — one live listing, not a growing pile.** Given I
   already have a published listing, when I change a field and publish again, the existing row
   is updated in place (`account_id` stays unique among `listing_type = 'shadchan'` rows,
   enforced by a partial unique index). A second `listings` row for the same shadchanus account
   is never created.

4. **The listing is anonymously readable the moment it exists — this is what "discoverable in
   search" means at this story's completion.** Given a published shadchan listing, when an
   **unauthenticated** client (Postgres role `anon`, no session) selects from `public.listings`,
   the row's opted-in fields come back. The human-facing search *page* is Story 9.4's; this
   story proves the data is already safely public before that page exists — verify with a raw
   `psql` session as role `anon` (Dev Notes has the exact query), not by clicking through a UI
   that doesn't exist yet.

5. **Withdrawal deletes the row and is immediate.** Given a published listing, when I withdraw
   it, the `listings` row is deleted (not soft-deleted, not flagged) and an immediate `anon`
   `select` returns zero rows for that account.

6. **Negative test — a household account can never publish a shadchan listing.** Given an
   `account_members` row with `role != 'shadchan'` in a `household`-kind account, when that
   member attempts `insert into listings (listing_type, account_id, shadchan_name) values
   ('shadchan', <their account>, 'X')` as `authenticated`, the insert is rejected by RLS. Assert
   this from **both** angles: wrong `kind` on the account, and wrong `role` on the member, as two
   separate checks.

7. **Negative test — tenant isolation holds.** Given two `shadchanus` accounts A and B each with
   a shadchan member, when B's member attempts to `select`, `update` or `delete` A's `listings`
   row through the **authenticated**-scoped policy (not the `anon` one, which is intentionally
   `using (true)`), all three are refused.

8. **Grants are exactly as narrow as AD-1 demands.** `anon` holds `select` on `public.listings`
   and **nothing else** — no `insert`, `update`, `delete`, and no sequence privilege. `select,
   insert, update, delete` on `public.listings` (for the `shadchan` branch only, per this
   story's own policies) are granted to `authenticated`. `rowsecurity` and
   `forcerowsecurity` are both `true` on `public.listings`.

## Tasks / Subtasks

- [ ] **Task 1 — Schema: create the `listings` table** (AC: 1, 2, 3, 6)
  - [ ] Append to `supabase/schemas/01_tables.sql`, in the shidduchim-domain section (after
        whatever the last table Epics 2–8 have added by then is — do not guess a line number,
        the file will have grown by seven epics' worth of migrations before this story starts).
        Full shape below; the `single_*` columns exist now even though only 9.2 ever writes
        them, so the table's shape is coherent from its first migration and 9.2 never needs to
        `ALTER TABLE` to add a column:
        ```sql
        create table public.listings (
            id bigint generated by default as identity primary key,
            account_id bigint not null,
            created_at timestamp with time zone not null default now(),
            listing_type text not null,
            single_id bigint,
            published_by_member_id bigint references public.account_members(id) on delete set null,

            -- Shadchan fields (FR101, story 9.1). Null = not opted in.
            shadchan_name text,
            shadchan_area text,
            shadchan_contact_info text,

            -- Single fields (FR102, story 9.2). Null = not opted in. Untouched by
            -- this story — do not write to these columns here.
            single_first_name_en text,
            single_first_name_he text,
            single_age integer,
            single_height text,
            single_community text,
            single_location text,
            single_summary text,
            single_photo_included boolean not null default false,

            constraint listings_type_check check (listing_type in ('shadchan', 'single')),
            constraint listings_single_id_presence check (
                (listing_type = 'single' and single_id is not null)
                or (listing_type = 'shadchan' and single_id is null)
            ),
            constraint listings_shadchan_name_required check (
                listing_type <> 'shadchan' or shadchan_name is not null
            ),
            constraint listings_single_name_required check (
                listing_type <> 'single'
                or single_first_name_en is not null
                or single_first_name_he is not null
            )
        );
        ```
  - [ ] `single_id` is a **soft reference, no FK** — same precedent as `inbox_items.single_id`
        (`01_tables.sql`, post-1.3 naming; see `1-3-rename-children-to-singles.md` AC 2, which
        explicitly notes `inbox_items.single_id` "carries neither an FK nor an index"). A
        conditional FK (only-when-`listing_type='single'`) is not expressible as a plain
        `foreign key`, and this story never writes `single_id` at all — 9.2 is the one that
        needs to decide whether to add a composite check at that point.
  - [ ] Indexes: `create index listings_account_id_idx on public.listings using btree
        (account_id);` plus the two **partial unique indexes** that make "one live listing per
        subject" real:
        ```sql
        create unique index listings_shadchan_account_id_key on public.listings (account_id)
            where listing_type = 'shadchan';
        create unique index listings_single_id_key on public.listings (single_id)
            where listing_type = 'single';
        ```
        Both indexes are created now (by this story) even though only the first is exercised
        until 9.2 — creating them together keeps the "exactly one live listing per subject"
        invariant declared in one place instead of two migrations disagreeing about it.
  - [ ] Trigger: reuse the existing generic `public.set_account_id_default()` (see
        `02_functions.sql`, currently `new.account_id := public.current_account_id();` — by
        this story it reads `current_context_id()`, per AD-19/Epic 2). **Do not write a new
        per-table function** — `04_triggers.sql` already has this exact one-liner pattern for
        every other shidduchim-domain table (`set_shidduchim_account_id`,
        `set_resumes_account_id`, etc.); add `set_listings_account_id` the same way:
        ```sql
        create or replace trigger set_listings_account_id
            before insert on public.listings
            for each row execute function public.set_account_id_default();
        ```

- [ ] **Task 2 — RLS policies for the `shadchan` branch only** (AC: 1, 2, 6, 7, 8)
  - [ ] `alter table public.listings enable row level security;` (and note `force row level
        security` — AD-1 requires `FORCE` on every table, including this one, even though its
        owner-facing policies are for `authenticated` and the table also carries a deliberate
        `anon` grant).
  - [ ] `"Listings readable by anon"` — `for select to anon using (true)`. This is deliberate
        and is the **entire point of AD-21**: a row's existence is what "published" means, so
        every column in every row is safe for `anon` to read by construction (no private column
        exists in this table at all).
  - [ ] `"Listings readable by owner"` — `for select to authenticated using (account_id =
        public.current_context_id())`. Lets a shadchan see (and 9.2's manager see) their own
        listing regardless of type — this policy is **shared** by both branches; write it once,
        here, so 9.2 does not duplicate it.
  - [ ] `"Shadchan listings insert"` — `for insert to authenticated with check (listing_type =
        'shadchan' and account_id = public.current_context_id() and exists (select 1 from
        public.accounts a where a.id = public.current_context_id() and a.kind = 'shadchanus')
        and exists (select 1 from public.account_members am where am.account_id =
        public.current_context_id() and am.user_id = auth.uid() and am.role = 'shadchan'))`.
  - [ ] `"Shadchan listings update"` — same predicate, `for update ... using (...) with check
        (...)`, so an existing listing can be edited in place (AC-3).
  - [ ] `"Shadchan listings delete"` — same predicate, `for delete ... using (...)`.
  - [ ] **Do not write any policy that mentions `listing_type = 'single'`.** That is 9.2's insert
        and update policies and 9.3's delete policy — see Dev Notes "Policy ownership map".

- [ ] **Task 3 — Grants** (AC: 8)
  - [ ] `revoke all on table public.listings from anon;` then `grant select on table
        public.listings to anon;` — `select` only, nothing else, ever.
  - [ ] `grant select, insert, update, delete on table public.listings to authenticated;`
        `grant all on table public.listings to service_role;`
  - [ ] `revoke all on sequence public.listings_id_seq from anon;` `grant usage, select on
        sequence public.listings_id_seq to authenticated;` `grant all on sequence
        public.listings_id_seq to service_role;` — the sequence must **never** be reachable by
        `anon` (per AD-1's "no other sequence grant to anon" posture); double-check the fork's
        `alter default privileges ... grant all on sequences to anon` (06_grants.sql, still
        present pending Epic-1/2's full closure of the `anon` surface — see
        ARCHITECTURE-SPINE.md#AD-1 "the `anon` surface is closed by Epic 2") does not silently
        hand this new sequence to `anon` — if it still applies when this story lands, add the
        explicit `revoke` regardless of whether the default-privilege block has been dropped yet.

- [ ] **Task 4 — Generate and hand-check the migration** (AC: all)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f add_listings`
        (`.claude/rules` / memory: every `npx supabase` call needs the `DBUS_SESSION_BUS_ADDRESS`
        prefix or it hangs on the keyring).
  - [ ] Hand-check per AGENTS.md and this repo's known `db diff` gaps: confirm the two partial
        unique indexes and both CHECK constraints are emitted; confirm `FORCE ROW LEVEL
        SECURITY` is included (AD-1) — `db diff` does emit this for a brand-new table, but
        verify rather than assume.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. **Never `db
        reset` and never `db push`.**

- [ ] **Task 5 — Types** (AC: 1, 2)
  - [ ] `src/components/atomic-crm/types.ts`: add a `Listing` type mirroring the table shape
        (all `single_*` fields present but this story only ever populates the `shadchan_*`
        ones), and a `ListingType = "shadchan" | "single"` union.

- [ ] **Task 6 — Provider** (AC: 1, 3, 8)
  - [ ] `providers/supabase/dataProvider.ts`: no bespoke RPC is needed — `listings` is plain
        `dataProvider.create` / `dataProvider.update` / `dataProvider.getList` /
        `dataProvider.delete` through the standard PostgREST seam (AD-10). Do **not** add a
        `publishShadchanListing` custom method; RLS is the authorization boundary (per
        `epics.md` Additional Requirements: "Supabase RLS is the enforcement layer; the app
        never enforces visibility alone") and the write shape is a plain row, not an atomic
        multi-table operation the way `create_shidduch()` is.
  - [ ] `providers/fakerest/dataProvider.ts` + `dataGenerator/`: add a `listings` base resource
        (empty array to start; 9.2 and later stories add generated rows). Mirror the
        `shidduchim`/`references` FakeRest wiring pattern already in the file (AD-10: "every
        new resource/method is mirrored in the FakeRest provider").

- [ ] **Task 7 — Components** (AC: 1, 2, 3)
  - [ ] New directory `src/components/atomic-crm/listings/` (new resource folder, following the
        existing lowercase-plural convention of `shidduchim/`, `shadchanim/`, `references/`).
        `listings` is **not** registered as a full `<Resource>` in `routeManifest.ts` — there is
        no authenticated list/show/edit surface to build; it is reached only through (a) a
        small settings panel (this story) and (b) the public search page (9.4). Flag to the epic
        owner if a future story wants a full admin list of "my listings" — nothing here forecloses
        adding one later.
  - [ ] `listings/PublishShadchanListingSection.tsx` — the three-toggle form described in AC-1/2,
        rendered from Settings when the active context's `kind === "shadchanus"`. Reads any
        existing listing via `dataProvider.getList("listings", { filter: { account_id:
        <active context> } })`, then `dataProvider.create` or `dataProvider.update` depending on
        whether a row already exists (AC-3 — the "upsert" is client-orchestrated because
        PostgREST's generic `create` does not expose `ON CONFLICT`).
  - [ ] `listings/WithdrawShadchanListingButton.tsx` — calls `dataProvider.delete("listings", {
        id })`; on success the row and the anon-visible listing are gone (AC-5).
  - [ ] Wire the section into `settings/` (e.g. a new `settings/ShadchanListingSection.tsx` shown
        conditionally, alongside the existing `FamilySection.tsx` / `PrivacySection.tsx`
        pattern) — the exact Settings-page composition depends on how Epic 2's context switcher
        (Story 2.4) exposes `kind`; if 2.4 has not landed a way to read the active context's
        `kind` in a component, treat that as a blocking prerequisite and say so rather than
        guessing at a client-side workaround.

- [ ] **Task 8 — Tests** (AC: all)
  - [ ] `supabase/tests/listings.sql` + `listings.test.ts` — new database suite, structured
        exactly like `supabase/tests/billing_entitlement.sql` (temp `results` table, `set local
        role authenticated; set local request.jwt.claims = '{"sub":"...","role":"authenticated"}'`
        per actor, JSON report, `rollback` at the end — do not invent a different test harness).
        Minimum checks: AC-1 (opted-out field stays `null`), AC-2 (CHECK constraint refuses a
        nameless shadchan listing), AC-3 (second publish updates, does not duplicate — partial
        unique index), AC-4 (an **anon**-role `select` — `set local role anon; set local
        request.jwt.claims = '{"role":"anon"}';`, mirroring `child_portal.sql`'s anon block —
        returns the row), AC-5 (delete removes it from the anon-visible set), AC-6 (both
        negative sub-cases: wrong `kind`, wrong `role`), AC-7 (cross-shadchanus isolation, both
        directions), AC-8 (`has_table_privilege`/`has_sequence_privilege` checks against `anon`,
        mirroring `child_portal.sql`'s grant assertions at lines ~250–262).
  - [ ] `providers/fakerest/dataProvider.summaryStats.test.ts`-style unit test or a new focused
        test file for the settings-panel upsert logic (create vs. update branch).
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db` (needs
        `make start`), plus `npx prettier --config ./.prettierrc.json --check` over this story's
        changed files only.

## Dev Notes

### Why this exists

> "AD-21 — Published listings are a snapshot; it is the only anon-readable relation. …
> publishing writes a `listings` row containing only the fields the publisher opted in, field
> by field; withdrawing deletes the row, which removes it from search immediately (FR105).
> `listings` is the sole relation granted to `anon`, and it physically contains no private
> column — so a leak is structurally impossible."
> [Source: ARCHITECTURE-SPINE.md#AD-21]

FR101 is the exact field list this story implements: *"A shadchan may publish a professional
listing (name, area, how to reach)."* [Source:
_bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md#A2.5]

### Policy ownership map across 9.1–9.3 (read before writing SQL)

`listings` is one table, but its RLS is split across three stories by `listing_type` and by
operation, using **separate named policies** rather than one shared policy with branching —
Postgres combines multiple permissive policies for the same command with `OR`, so each story
adds policies without ever editing another story's SQL:

| Policy | Command | `listing_type` | Owning story |
|---|---|---|---|
| `Listings readable by anon` | select | both | **9.1** |
| `Listings readable by owner` | select | both | **9.1** |
| `Shadchan listings insert` | insert | shadchan | **9.1** |
| `Shadchan listings update` | update | shadchan | **9.1** |
| `Shadchan listings delete` | delete | shadchan | **9.1** |
| `Single listings insert` | insert | single | **9.2**, later **replaced** by 9.3 (adds the dignity-floor lock predicate — the lock column does not exist until 9.3, so 9.2's version of this policy cannot reference it) |
| `Single listings update` | update | single | **9.2** |
| `Single listings delete` | delete | single | **9.3** |

If you are implementing 9.1, you touch only the first five rows. Do not pre-empt 9.2/9.3 by
writing a "single" policy "while you're in the file" — the lock semantics in 9.3 are exact and
adding a premature policy would need to be dropped and rewritten anyway.

### `listings` vs `shadchanim` — the naming collision to not fall into

`public.shadchanim` (unchanged by this story) is a **household's private CRM record** of a
matchmaker they work with — `name`, `location`, `contacts jsonb`, `notes`, `responsiveness`,
scoped to the household's own `account_id`. It is never read from, written to, or joined against
by this story. The shadchan **publishing** a listing here is doing so about **their own
`shadchanus` account** (Epic 8), a completely different row in a completely different account.
Do not add a foreign key or join between `listings` and `shadchanim` — there is no relationship;
they describe different people from different sides of the relationship (a household's opinion
of a matchmaker vs. the matchmaker's own public-facing profile).

### Security / RLS

This is a new anon-readable table — `.claude/rules/security-triggers.md` mandates a security
review and negative tests (AC-6, AC-7) for exactly this reason. The two failure modes worth
naming explicitly, because they are the two ways a "sole anon-readable relation" claim quietly
becomes false:
1. **A private column sneaking onto this table later.** Because `anon` gets a blanket
   `using (true)` `select`, *any* column ever added to `listings` is public forever. Any future
   story that wants to add a column here must ask "would I be comfortable with a stranger
   reading this with no login?" — if not, it does not belong on this table.
2. **The default-privilege `anon` grant reasserting itself.** `06_grants.sql` still carries
   `alter default privileges for role postgres in schema public grant all on tables to anon;`
   from the fork, pending Epic 1/2 closing it under AD-1. If that block still exists when this
   migration runs, a **new** table created after it would inherit far more than `select` unless
   this story's explicit `revoke`/`grant` sequence (Task 3) runs in the same migration — which
   it does. Do not rely on the default-privilege block having been dropped by the time this
   story lands; the explicit grants make this story correct either way.

### Migration workflow for this repo (non-obvious, gets people)

- `supabase/schemas/*.sql` is the source of truth; migrations are generated from it
  [Source: AGENTS.md#Database-Management].
- Every `npx supabase …` call needs `DBUS_SESSION_BUS_ADDRESS=/dev/null` prefixed or it hangs on
  the keyring [Source: memory/supabase-cli-dbus-hang.md].
- Loop: edit `supabase/schemas/*` → `db diff --local -f <name>` → hand-check → `migration up
  --local`. Never `db reset --local`, never `db push` from a story.
- Unlike a rename, this is a brand-new table, so `db diff`'s well-known rename-related failure
  modes (DROP+CREATE instead of RENAME, dropped `security_invoker`) do not apply here — but
  still verify the emitted `FORCE ROW LEVEL SECURITY` and the partial unique indexes, since a new
  object can still be emitted incompletely.

### Testing standards

AAA structure, descriptive names, isolated fixtures, ≥80% coverage on new paths
[Source: .claude/rules/testing.md]. The database suite (`supabase/tests/listings.sql`) is
**not** part of `make test` — it runs only under `npm run test:unit:db`
[Source: vitest.config.ts:124, makefile:108] — call this out explicitly when reporting this
story done, exactly as story 1.3 had to for the same reason.

### Project Structure Notes

- New table lives in the existing `supabase/schemas/01_tables.sql` shidduchim-domain section;
  no new schema file.
- New component directory `src/components/atomic-crm/listings/`, lowercase-plural, matching
  `shidduchim/` / `shadchanim/` / `references/`.
- `.claude/rules/coding-style.md`: 200–400 lines typical, 800 max per file. Nothing here should
  approach that — keep `PublishShadchanListingSection.tsx` focused on the three-toggle form and
  put the upsert-decision logic in a small hook (`useShadchanListing.ts`) if the component would
  otherwise grow past ~150 lines.
- English-only in all committed content [Source: .claude/rules/english-only.md].

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-9-Listings--Sharing]
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md#A2.5] — FR101, PRV-13
- [Source: ARCHITECTURE-SPINE.md#AD-1] — scope + forced RLS, `anon` grant discipline
- [Source: ARCHITECTURE-SPINE.md#AD-2] — `accounts.kind`, `account_members.role`, shadchan active
- [Source: ARCHITECTURE-SPINE.md#AD-19] — `current_context_id()` replaces `current_account_id()`
- [Source: ARCHITECTURE-SPINE.md#AD-21] — the listings snapshot itself, verbatim rule
- [Source: _bmad-output/specs/spec-myshadchan/glossary.md#Identity-and-access] — "listing" definition
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/SOLUTION-DESIGN.md §4] — `listings` in the data model, `accounts.kind`
- [Source: supabase/schemas/02_functions.sql — `set_account_id_default()`] — the reusable trigger this story must not duplicate
- [Source: supabase/schemas/01_tables.sql — `inbox_items.single_id`] — precedent for a soft (no-FK) reference column
- [Source: supabase/tests/billing_entitlement.sql, supabase/tests/child_portal.sql] — the test-suite template and the anon-role test-block pattern
- [Source: 1-3-rename-children-to-singles.md#AC-2] — `inbox_items.single_id` carries no FK/index, the precedent this story's `single_id` follows
- [Source: .claude/rules/security-triggers.md] — RLS-touching diffs require security review + negative tests
- [Source: AGENTS.md#Database-Management] — schema-first workflow

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
