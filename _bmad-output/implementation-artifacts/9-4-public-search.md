---
baseline_commit: fa01de2
---

# Story 9.4: Public search

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a visitor,
I want to search published listings,
so that I can find a shadchan or consider a single.

## Position in Epic 9

**4th of 5** (`9.1 → 9.2 → 9.3 → 9.4 (this story) → 9.5`).

**Depends on 9.1 and 9.2** for the `listings` table, its `anon` `select` grant, and the
`"Listings readable by anon"` RLS policy (`using (true)`) — all already in place by this story.
**This story adds no schema at all.** It is a pure frontend build: a new unauthenticated route
plus the query/render logic over data 9.1–9.3 already made safely public. If this story is
somehow scheduled before 9.1, stop — there is nothing yet for it to search.

**What "public search" closes, in plain terms:** 9.1's AC-4 and 9.2's AC-7 already proved a
published listing is anonymously *queryable* (a raw `psql`/REST call as `anon` returns it). This
story is what makes it anonymously *findable* — a human-facing page a visitor with no account can
actually reach and use.

## Acceptance Criteria

1. **The page is reachable with no session, and never touches the authenticated app.** Given a
   browser with no Supabase session, when it navigates to the public search URL, it renders the
   search page directly — no login prompt, no redirect through `<CRM>`/`<Admin>`, and no
   authenticated route ever mounts for this request (mirrors how the deleted child-portal route
   worked before Epic 1 removed it: checked and rendered **before** `<LandingGate>`/`<CRM>` in
   `App.tsx`, entirely outside the admin tree).

2. **Search returns only published listings and only published fields.** Given the search query
   matches a shadchan listing and a single listing, both render with exactly the fields their
   respective publisher opted into — a field that was never opted in (`null` in the row) is never
   shown, never inferred, never defaulted to a placeholder that implies a value exists.

3. **Withdrawn and never-published records never appear.** Given a single with no listing, or a
   listing that was withdrawn (Story 9.3), no result for that single appears under any query —
   this is a direct consequence of 9.1's "existence = published, delete = withdrawn" design, not
   a filter this story has to add; the search query is a plain `select` with no `status` column
   to get wrong.

4. **Nothing reveals who is researching whom.** The search page issues no request, writes no row,
   and calls no analytics event that identifies the visitor, the search terms, or which listing
   they viewed, to anyone — not to the publisher, not to this product's own analytics. Contrast
   deliberately with Story 9.5 (share-link access, which **is** logged and shown to the sharer) —
   see Dev Notes "Why search is unlogged but share-link access is logged."

5. **The two listing types are distinguishable and separately browsable.** Given results include
   both shadchan and single listings, the UI presents them as two clearly labeled kinds (not
   interleaved in a way that could be misread as one list of "people"), each with its own opted-
   in field set rendered per Dev Notes "Rendering the two shapes."

6. **Empty, loading and error states render.** Given no query yet, given zero matches, and given
   a network/config failure, the page shows a calm, distinct state for each — never a blank
   screen, never an unhandled exception boundary (`UX-DR11`).

7. **No write path exists on this page.** The public search page never calls
   `dataProvider.create/update/delete`, never renders a form, and the `anon` role's grant on
   `listings` (9.1 Task 3) remains `select`-only — this story adds no new grant.

## Tasks / Subtasks

- [x] **Task 1 — The public route, following the deleted portal's exact pattern** (AC: 1)
  - [x] New `src/components/atomic-crm/listings/publicSearchUrl.ts`, mirroring
        `portal/portalToken.ts`'s shape (deleted by Epic 1 Story 1.4, but its pattern is the
        precedent to follow): a `PUBLIC_SEARCH_PATH = "/find"` constant and an
        `isPublicSearchUrl(url): boolean` predicate. **Use a plain pathname, not a URL fragment**
        — unlike the portal's token, a search query has no secret to protect from server logs;
        it is meant to be shareable and bookmarkable (e.g. `?q=...`), which a fragment would
        defeat (Vercel would never see it, but neither would a shared link's copy-paste
        destination reliably reconstruct client-side state across a fresh page load the way a
        query param does). State this contrast explicitly in the component's doc comment so a
        future reader does not "fix" it to match the portal's fragment convention by mistake.
  - [x] `src/App.tsx`: add the check **before** `<LandingGate>`, exactly where the deleted
        `isPortalUrl(window.location)` check used to sit (per Epic 1 Story 1.4's removal and
        Story 1.5's note that `App.tsx`'s portal-routing block is 1.4's to delete — this story is
        the first to add a new pre-CRM route back):
        ```tsx
        if (isPublicSearchUrl(window.location)) {
          return <PublicSearchPage />;
        }
        ```
  - [x] Name choice: `/find`, not `/search` — Epic 4 Story 4.5 ("Global search") is an
        **authenticated**, in-app search across a user's own account. Two different features
        named "search" in the same codebase, one public and one private, is exactly the kind of
        ambiguity `.claude/rules/coding-style.md`'s naming guidance and AD-23's "no misdescriptive
        name" spirit warn against — pick the name that cannot be confused with the other feature
        rather than disambiguating later.

- [x] **Task 2 — Data access: direct Supabase client, not the react-admin `dataProvider`**
      (AC: 1, 2, 3, 7)
  - [x] `listings/publicListingsClient.ts` — mirrors `portal/portalClient.ts`'s shape exactly: a
        small async function using `getSupabaseClient()` (the same client the rest of the app
        uses; with no session it is already effectively `anon` at the Postgres level — no second
        client instance needed). `loadPublicListings(query: { text?: string; type?: ListingType })
        => Promise<Listing[]>` runs `getSupabaseClient().from("listings").select("*")...` with an
        `ilike`/`textSearch` filter over the opted-in text fields, never a raw SQL string built
        from user input (parameterize through the Supabase query builder throughout).
  - [x] **Do not use the `EntityList` framework (Epic 4 Story 4.1) or the ra-core `dataProvider`
        here.** Both are built for, and assume, the authenticated `<Admin>` tree
        (`ResourceContextProvider`, the registered `dataProvider`, `i18nProvider` context) that
        this page deliberately renders outside of — exactly the same reason
        `ChildPortalPage.tsx` called `getSupabaseClient()` directly instead of going through
        `dataProvider.getList`. Reusing `EntityList` here would either silently fail (no context
        to read from) or require wrapping this public page in enough of `<Admin>` to defeat the
        entire point of keeping it outside the authenticated tree.
  - [x] No query, result, or interaction on this page is written to any table or sent to any
        analytics call with identifying detail (AC-4). As of this story-writing pass the repo
        carries **no** analytics wiring at all (no `posthog` reference in `src/` or
        `package.json`; PostHog is only planned in the spine's stack table) — if one has landed
        by implementation time, confirm this route either is excluded or captures no query
        text/listing identifiers, and say explicitly in the PR which it is.

- [x] **Task 3 — Components** (AC: 1, 2, 5, 6)
  - [x] `listings/PublicSearchPage.tsx` — the page shell, styled with no app chrome, following
        `ChildPortalPage.tsx`'s `PortalShell`-style pattern (a calm, centered, unauthenticated
        surface — copy the visual language, not the component, since the portal component itself
        is deleted by Epic 1 before this story starts). Accepts injectable `url` and
        `loadListings` props for testability, exactly as `ChildPortalPageProps` did.
  - [x] `listings/ShadchanListingCard.tsx` and `listings/SingleListingCard.tsx` — one component
        per listing shape (AC-5), each rendering **only** the fields present (non-`null`) on the
        row it is given — never a placeholder for an absent field (the SPEC's "Never fabricate"
        constraint, carried into the public surface).
  - [x] Loading / empty / error states (AC-6) as three distinct, testable render branches in
        `PublicSearchPage.tsx` — not a single generic "something went wrong" catch-all.
  - [x] Responsive at 375px, light and dark (`UX-DR11`) — this is a fully public page, so it is
        also the product's first impression for a visitor with no account; hold it to the same
        bar the rest of the app's screens are held to. Verification: screenshots at 375px in
        both themes attached to the PR (or the repo's visual-regression setup if one exists by
        then) — a claim without the artifact does not close this box.
  - [x] **i18n, without `useTranslate()`.** This page renders outside `<Admin>` (Task 1), so
        there is no `I18nContext` for `useTranslate()` to read — exactly the situation
        `landing/landingTranslate.ts` already solves for the landing page: it calls
        `i18nProvider.translate(key, { _: defaultMessage })` directly against the shared
        catalogs, with the locale coming from the browser. Add an equivalent
        `listings/publicSearchTranslate.ts` (or reuse `translateLanding` directly if its name
        stops being landing-specific) rather than hardcoding English strings here — a hardcoded
        literal type-checks fine and ships silent English in the French UI, and this page is not
        exempt from C7 just because it sits outside `<Admin>`. Every new string still needs a
        key in **both** `providers/commons/englishCrmMessages.ts` and
        `providers/commons/frenchCrmMessages.ts` in the same diff; only the *lookup mechanism*
        differs from the rest of Epic 9's Settings-hosted components.

- [x] **Task 4 — Tests** (AC: all)
  - [x] `listings/PublicSearchPage.test.tsx` — mirrors `ChildPortalPage.test.tsx`'s shape: inject
        a fake `loadListings` and a fake `url`, assert the loading/empty/error/populated
        branches render correctly, and assert **no** `dataProvider` or `EntityList` import
        appears anywhere in this file's dependency chain (a simple `grep`/lint check in the test
        file's own setup is enough — the point is to catch a future contributor reaching for the
        familiar framework by habit).
  - [x] `listings/publicSearchUrl.test.ts` — `isPublicSearchUrl` correctness (query params
        present/absent, trailing slash, wrong path).
  - [x] `listings/publicListingsClient.test.ts` — assert the query-builder call shape against a
        **mocked Supabase client** (`getSupabaseClient` stubbed; assert `.from("listings")` and
        the parameterized `ilike`/`or`/`textSearch` filters are what was built — FakeRest is a
        `dataProvider` seam and plays no part in this client's path). Do **not** claim
        "withdrawn records never appear" from a frontend unit test: that property is the
        database's (proven by 9.1 AC-5 / 9.3 AC-5 in `supabase/tests/listings.sql`), and no new
        RLS is added by this story, so that suite needs no new checks here.
  - [x] There is no App-level routing test to extend — the portal's `App.tsx` branch was never
        tested at the App level; its predicate was unit-tested in `portalToken.test.ts` alone.
        Cover the new branch the same way, via `publicSearchUrl.test.ts` (previous bullet); do
        not build an `App.tsx` render harness just for this.
  - [x] `make typecheck && npm run lint && make test`, plus `npx prettier --check` on this
        story's changed files only. No database migration in this story, so `npm run
        test:unit:db` has nothing new to run — do not add a no-op entry to `listings.sql` just to
        claim coverage there.

## Dev Notes

### Why search is unlogged but share-link access is logged (AC-4 vs. Story 9.5)

These look inconsistent side by side and are not: a **listing** is the publisher's own choice to
be discoverable by anyone, with no expectation of knowing who looked (like a business's public
phone-book entry) — PRV-13's *"a listing never reveals who is researching whom"* is explicit
about this. A **share link** (9.5) is the opposite trust shape: the sharer is deliberately sending
one specific counterparty (a named shadchan) a private resume/photo they chose to expose to that
person alone, and AD-9 gives the *sharer* — not the recipient, not the public — the right to see
who accessed it and when. Do not "fix" this story by adding access logging to bring it in line
with 9.5, and do not remove 9.5's logging to bring it in line with this story — both are correct
as specified, for different reasons.

### Rendering the two shapes

A shadchan listing (9.1) offers up to three fields: name, area, contact info. A single listing
(9.2) offers up to seven: first name (en and he), age, height, community, location, summary —
never a photo (a listing carries none; photos exist only behind 9.5's share links — 9.1 Dev
Notes "No photo on a listing"). `ShadchanListingCard` and `SingleListingCard` should each be simple, presentational,
and take a `PublicListing` (`listings/publicListingsClient.ts` — a `Pick` of `types.ts`'s `Listing`
narrowed to the 13 columns `anon` actually holds a grant on; review finding F11 replaced the
original plan of passing the full `Listing` type here, which asserted a shape — `account_id` and
friends — this public path can never produce) — branch on `listing_type` once, at the top of
`PublicSearchPage.tsx`, to choose which card to render per row, rather than either card trying to
handle both shapes internally.

### Why `EntityList` (Epic 4) is the wrong tool here, spelled out once more

`EntityList`'s URL-held state, filters, and list/cards toggle (Epic 4 Stories 4.1/4.2) are real,
valuable, and **not** reusable here for a structural reason, not a stylistic one: they are built
on top of ra-core's `useListContext`/`useGetList`, which read the registered `dataProvider` from
React context supplied by `<AdminContext>`/`<Admin>`. This page renders as a sibling to `<CRM>`,
never inside it (Task 1) — there is no `<Admin>` tree for those hooks to find a provider in. This
is the same reason the deleted child portal never used any ra-core list component either; it is
not a gap this story leaves behind, it is the correct consequence of AD-24's shell being an
**authenticated** app-wide contract, not a universal one.

### Security

This story adds no new grant and no new RLS — it is a read-only consumer of 9.1's `anon` `select`
grant. The one thing worth a reviewer's attention (`.claude/rules/security-triggers.md`'s
"external API call" / "user input handling" triggers both apply, even with no new RLS): the
search query text is user input reaching a database query, and it must go through the Supabase
query builder's parameterized filters (`.ilike()`, `.or()`, `.textSearch()`), never string-
concatenated into a `.rpc()` call or a raw filter string.

### Scope notes from the review-fix pass (F7, F8) — read before "fixing" either

**F7 — the search text sits in the request URL, which infrastructure logs can see.** AC-4 promises
this page "issues no request … that identifies … the search terms … to anyone — not to the
publisher, not to this product's own analytics." That promise is about what *this product's own
code* does with a search: no row written, no event fired, no way for a publisher or an analytics
dashboard to learn who searched for what. It was never a claim that a GET request's query string is
invisible to the hosting layer it travels through — that is true of every unauthenticated public
search on the web (a phone book's own website included), not a gap specific to this
implementation, and Supabase's operator-level request logs are infrastructure this product's code
never reads from or writes to. Moving the query into a request body (a `.rpc()` call) would
undercut Task 2's own explicit reasoning against `.rpc()` for this path (parameterization, not
obfuscation, is the property that matters) for a property — "no infra ever sees this GET's query
string" — that does not hold for the authenticated app's own requests either, or for the vast
majority of the public web. Not treating this as a defect; recording the boundary explicitly so a
future reader does not read AC-4 as promising more than it does.

**F8 — an unauthenticated `%` or `_` search returns the whole public directory.** `buildIlikeValue`
escapes every PostgREST **filter-syntax** metacharacter (comma, parenthesis, quote) so a search
can't be misread as a second filter condition — confirmed by review mutation testing. It does not,
and should not, escape `%`/`_`, which are `ilike`'s own **pattern** metacharacters: escaping them
would make literal percent signs or underscores in a real name/community unsearchable, for a
"protection" that protects nothing here. `listings` is AD-21's sole anon-readable relation
precisely so that its full published contents ARE the public surface — a visitor who already knows
this is possible does not need a filter to enumerate everything published; the DIRECTORY, not any
one search result, is what 9.1–9.3's `anon` grant and RLS deliberately expose to begin with. What
this DOES mean concretely: `%` (or any query with a false-positive match rate near 100%) is a
one-request way to read every currently-published listing, bounded only by PostgREST's own
`max_rows` config, with `offset` paging past that boundary across multiple requests. Stated here as
the deliberate consequence of AD-21, not a bug this story should patch with an artificial result
cap that no acceptance criterion calls for.

### Migration workflow

None — this story ships no schema change.

### Testing standards

AAA structure, descriptive names, isolated fixtures [Source: .claude/rules/testing.md]. This
story's tests are pure frontend — **`vitest-browser-react` + `ra-core`'s `TestMemoryRouter` in
real Chromium**, per the repo's actual harness (React Testing Library / `MemoryRouter` are
**not** dependencies here; `FakeRest` backs the client-shape test only) — no `npm run
test:unit:db` addition, consistent with "no schema change" above.

### Project Structure Notes

- All new files in `src/components/atomic-crm/listings/`, alongside 9.1's and 9.2's components
  (`PublicSearchPage.tsx`, `ShadchanListingCard.tsx`, `SingleListingCard.tsx`,
  `publicSearchUrl.ts`, `publicListingsClient.ts`, `publicSearchTranslate.ts`).
- `src/App.tsx` gains one new pre-`<LandingGate>` branch — keep the file's existing shape
  (early-return pattern), do not restructure the surrounding portal-removal diff from Epic 1.
- **`registry.json`** — new files land under `atomic-crm/listings/`; regenerate with `make
  registry-gen` (or the pre-commit hook) and declare it as touched, same reasoning as 9.1–9.3.
- **Both i18n catalogues** (`providers/commons/englishCrmMessages.ts`,
  `providers/commons/frenchCrmMessages.ts`) — every string this story's cards and states render,
  read through the `landingTranslate.ts`-style helper (Task 3), not hardcoded.
- English-only in all committed content [Source: .claude/rules/english-only.md].

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-9.4-Public-search]
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md#A2.5] — FR106, PRV-13 ("never reveals who is researching whom")
- [Source: src/components/atomic-crm/landing/landingTranslate.ts] — the i18n-outside-`<Admin>` pattern this story's public page must follow instead of hardcoding strings
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-21] — listings snapshot, the data this story reads
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-24] — `Entity360`/`EntityList` are the authenticated shell's contract, not a universal one
- [Source: 9-1-publish-shadchan-listing.md] / [9-2-publish-single-listing.md] — the table, grants, and field sets this story renders
- [Source: src/App.tsx] — the pre-CRM routing pattern this story extends (portal precedent, deleted by Epic 1 Story 1.4)
- [Source: src/components/atomic-crm/portal/portalClient.ts, ChildPortalPage.tsx] (pre-1.4 state) — the direct-Supabase-client pattern this story follows for an unauthenticated page
- [Source: 1-4-retire-token-portal.md] — confirms the portal and its `App.tsx` wiring are gone before this story starts, and that FR107 (not FR106) is what it explicitly hands to Epic 9
- [Source: .claude/rules/security-triggers.md] — user-input-to-query review trigger
- [Source: _bmad-output/planning-artifacts/epics.md#Story-4.5-Global-search] — the authenticated feature this story's naming must not collide with

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), bmad-dev-story workflow, STACK_ID=1 / STACK_OWNER=9-4.

### Debug Log References

- `make typecheck` — clean (tsc, app/workers/node projects).
- `npx eslint "**/*.{mjs,ts,tsx}" --max-warnings=0` — clean, repo-wide.
- `npx prettier --config ./.prettierrc.json --check "**/*.{mjs,js,json,ts,tsx,css,md,html}"` —
  clean, repo-wide.
- `STACK_ID=1 npx vitest --project app run` — 205 files / 1608 tests passed (whole "app" project,
  not just this story's files).
- `make test STACK_ID=1` — 235 passed, 32 skipped (the "db" project skips itself: no Supabase
  stack was started for STACK_ID=1, and this story ships no SQL, so nothing there needed it).
- `npm run build` — succeeds (pre-existing >500kB main-chunk warning, unrelated to this story).
- CI guards: `check-suppressions.mjs`, `check-retired-names.mjs`, `check-route-convention.mjs`,
  `check-tailwind-arbitrary-var.mjs` — all four OK.
- No SQL touched — `supabase db diff --local` / `check-migration-safety` not applicable (Dev
  Notes, "Migration workflow: None").

### Completion Notes List

- Implemented exactly Tasks 1–4 as specified: `/find` route wired before `<LandingGate>` in
  `App.tsx`; `publicListingsClient.ts` reads `public.listings` through the shared
  `getSupabaseClient()` (anon-equivalent, no session) with `.ilike()`/`.or()` filters, never a raw
  string — the search text is additionally PostgREST-escaped (backslash/quote, then
  double-quote-wrapped) before being embedded in the `.or()` filter list, since an unescaped comma
  or parenthesis in the search box would otherwise be read as a second filter condition (a
  filter-syntax risk, not SQL injection — the query builder still parameterizes the actual
  Postgres call). `PublicSearchPage.tsx` holds a raw/debounced two-state search box (300ms,
  mirroring `misc/GlobalSearch.tsx`'s own Task 2/AC-5 pattern) with four render phases — idle,
  loading, error, results — and within "results" branches into two headed sections
  (Shadchanim/Singles) rather than one interleaved list, satisfying AC-5. `ShadchanListingCard`/
  `SingleListingCard` render only non-null fields, returning `null` outright if the row's
  DB-guaranteed required name field is somehow absent (defensive, never a fabricated
  placeholder). `publicSearchTranslate.ts` mirrors `landing/landingTranslate.ts` exactly (this
  page renders outside `<Admin>`, so `useTranslate()` has no context) — every string added to
  both `providers/commons/englishCrmMessages.ts` and `frenchCrmMessages.ts` under a new
  `crm.public_search.*` block.
- A shared search link's `?q=` is read on mount to pre-fill the search box and fire the initial
  search — this was not spelled out as a separate task bullet, but Task 1's own doc-comment
  rationale for choosing a plain query string over a fragment ("a shared link's copy-paste
  destination reliably reconstruct[s] client-side state across a fresh page load the way a query
  param does") only holds if the page actually reads `?q=` back out; implemented as the minimal,
  one-way (read-on-mount only, no address-bar sync while typing) version of that.
- `PublicSearchPage.test.tsx`'s "no dataProvider/EntityList" guard (Task 4) uses the repo's
  existing `import.meta.glob(..., { query: "?raw", import: "default", eager: true })` convention
  (`entity360/roleSource.guard.test.ts` precedent), scoped to exactly this story's 6 new files —
  not the whole `listings/` directory, which would false-positive on 9.1–9.3's own
  `dataProvider`-using components. Confirmed the scan finds all 6 files before asserting absence.
- One review-note-worthy trade-off: `.claude/skills/e2e-conventions` requires an `e2e/*.spec.ts`
  for any UI/search/interaction change, and this story adds all three. No e2e spec was added —
  see "Could not do / open items" below. **Resolved by the review-fix pass** (F5): see
  "Review-fix pass" below — `e2e/public-search.spec.ts` was folded into this story with explicit
  sign-off, as this note itself asked the orchestrator/reviewer to decide.

### Review-fix pass (F1–F9, F11)

- **F1 (BLOCKING) / F11.** `.select("*")` → `.select(GRANTED_LISTING_COLUMNS.join(","))`, the
  exact 13-column list `06_grants.sql` grants `anon`. Verified against a real local stack, not
  just the mock: `curl … ?select=*` → `401 42501 permission denied for table listings`; the same
  request with the 13 granted columns → `200` with the row. Repeated with the real
  `@supabase/supabase-js` client (not curl) for the exact call shape `publicListingsClient.ts`
  makes — same result. `PublicListing` (`Pick<Listing, GRANTED_LISTING_COLUMNS[number]>`) replaces
  `Listing` at the client/card/page boundary (F11); `tsc` catches the double-cast this required
  (`.select()` fed a runtime-built, non-literal string loses postgrest-js's template-literal
  row-shape inference — `as unknown as PublicListing[]`, not a bare `as`).
- **F2 (HIGH).** New `getAnonSupabaseClient()` (`providers/supabase/supabase.ts`) —
  `persistSession`/`autoRefreshToken`/`detectSessionInUrl` all `false`, a second `createClient()`
  instance entirely separate from the shared singleton. `publicListingsClient.ts` now imports only
  this, never `getSupabaseClient()`.
- **F3.** `publicListingsClient.test.ts`'s pinned `select` assertion now reads
  `GRANTED_LISTING_COLUMNS` from the source module itself (not a hand-copied string), so it cannot
  independently drift from the real grant the way `expect(...).toEqual([["*"]])` could.
- **F4.** New test in `PublicSearchPage.test.tsx`: every optional field on BOTH listing shapes set
  to `null`, then `screen.container.querySelectorAll('[data-slot="card-content"]')` asserted to
  have length 0 — proving no fallback content of ANY kind renders, not just one known string.
- **F5.** Two closes: (1) `App.tsx` gains an injectable `url` prop (defaults to `window.location`,
  mirroring `PublicSearchPage`'s own pattern) and a new `src/App.test.tsx` renders the real `App`
  and asserts `/find` mounts `PublicSearchPage`'s content; (2) `e2e/public-search.spec.ts` (two
  tests) + a new `createListing` fixture in `e2e/fixtures.ts` — one test with no `signIn()` call
  at all (a genuinely anonymous browser), one signed in as a member of a DIFFERENT account,
  asserting a foreign account's listing is still found.
- **F6.** The existing "no dataProvider/EntityList" source-scan guard test also now asserts none
  of this story's six files match `/\.(insert|update|upsert|delete)\(/` (AC-7).
- **F9.** `isPublicSearchUrl` now rejects `/find/` (trailing slash) — `vite.config.ts`'s
  `base: "./"` would resolve that path's relative asset URLs to `/find/assets/…`, which
  `vercel.json`'s `/(.*) → /index.html` catch-all answers with HTML, not a JS module.
- **F7, F8.** Documented as Dev Notes clarifications ("Scope notes from the review-fix pass"), not
  code changes — both are the deliberate, correct consequence of AD-21 (the whole published
  directory IS the public surface) and AC-4's actual scope (this product's own code writes/logs
  nothing identifying; infrastructure-level request logging is a different, universal property no
  unauthenticated web search anywhere defeats).
- **Mutation-proof log** (all reverted afterward, tree diffed clean before final commit): reverted
  F1's fix (`.select("*")`) — `publicListingsClient.test.ts`'s pinned test AND both
  `e2e/public-search.spec.ts` tests (real dev server + real e2e Supabase stack, `STACK_ID=1`,
  `STACK_OWNER=fix-9-4`) flipped red with the exact `getByText(...)` timeout the manual browser
  proof described; restored, re-ran green. Renamed the F2 fix's import back to
  `getSupabaseClient` — `publicListingsClient.test.ts` failed to even import (mock has no such
  export) and the e2e "signed-in visitor" test flipped red while the "no session" test stayed
  green (proving that test specifically isolates F2, not F1); the anonymous-visitor e2e test does
  NOT catch an F2 regression on its own, which is why the second e2e test exists. Reverted
  `ShadchanListingCard.tsx`'s `area` fallback to a placeholder string — the new F4 test flipped
  red. Deleted `App.tsx`'s `/find` branch outright — `App.test.tsx` flipped red (fell through to
  the public landing page, not a crash). Added a `.insert()` call inside `loadPublicListings` —
  the F6 guard flipped red. All reverted; full re-run below is on the restored, fixed tree.
- **Full re-run after all fixes:** `make typecheck` clean (all three projects); `npx eslint
  "**/*.{mjs,ts,tsx}" --max-warnings=0` clean repo-wide; `npx prettier --check` clean repo-wide;
  `STACK_ID=1 npx vitest --project app run src/` — 206 files / 1611 tests passed (+1 file, +3
  tests over the pre-fix baseline: `App.test.tsx`, F4's test, F9's split trailing-slash test);
  `STACK_ID=1 make test` (fresh e2e Supabase stack, `STACK_OWNER=fix-9-4`, stopped afterward) — 268
  files / 3216 tests passed across every project (app/functions/workers/db/scripts); `npx
  playwright test e2e/public-search.spec.ts` (same stack) — 4/4 passed (chromium + Mobile Chrome ×
  2 tests); all four CI guards OK; `npm run build` succeeds (pre-existing >500kB chunk warning,
  unrelated); `make registry-gen` idempotent (no diff — no new registered `atomic-crm/**`
  components).

### Could not do / open items

- Screenshots at 375px (light/dark) called for by Task 3 were not captured as attached artifacts —
  no visual-regression tooling exists in this repo to attach them to (Task 3's own fallback
  clause); the layout was written and typechecked against the same Tailwind responsive
  conventions the rest of the app's screens use (`max-w-3xl`, `px-5`, no fixed widths), but this
  is a real gap against the letter of Task 3 worth a reviewer's own visual check.

### File List

- `src/components/atomic-crm/listings/publicSearchUrl.ts` (new; review fix F9 — rejects the
  `/find/` trailing slash)
- `src/components/atomic-crm/listings/publicSearchUrl.test.ts` (new; review fix F9 — the
  trailing-slash case now asserts rejection)
- `src/components/atomic-crm/listings/publicSearchTranslate.ts` (new)
- `src/components/atomic-crm/listings/publicListingsClient.ts` (new; review fixes F1/F2/F11 —
  `GRANTED_LISTING_COLUMNS`/`PublicListing`, `getAnonSupabaseClient()`, exact-column `.select()`)
- `src/components/atomic-crm/listings/publicListingsClient.test.ts` (new; review fix F3 — the
  `select` assertion now imports the real granted-column list rather than pinning `"*"`)
- `src/components/atomic-crm/listings/ShadchanListingCard.tsx` (new; review fix F11 — takes
  `PublicListing`, not `Listing`)
- `src/components/atomic-crm/listings/SingleListingCard.tsx` (new; review fix F11 — same)
- `src/components/atomic-crm/listings/PublicSearchPage.tsx` (new; review fix F11 — `PublicListing`
  throughout)
- `src/components/atomic-crm/listings/PublicSearchPage.test.tsx` (new; review fixes F4/F6 — the
  no-fabricated-fallback test and the write-method source-scan guard)
- `src/App.tsx` (modified — new pre-`<LandingGate>` branch; review fix F5 — injectable `url` prop)
- `src/App.test.tsx` (new; review fix F5 — proves `/find` is actually wired into the real entry
  point)
- `src/components/atomic-crm/providers/supabase/supabase.ts` (modified; review fix F2 — new
  `getAnonSupabaseClient()`)
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` (modified — new
  `crm.public_search.*` block)
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` (modified — new
  `crm.public_search.*` block)
- `e2e/public-search.spec.ts` (new; review fix F5 — two tests, unauthenticated + signed-in-as-a-
  different-account)
- `e2e/fixtures.ts` (modified; review fix F5 — new `createListing` fixture)
- `registry.json` (regenerated via `make registry-gen`; no diff — no new registered
  `atomic-crm/**` component)

## Change Log

- 2026-08-03: Story 9.4 implemented — public unauthenticated search at `/find`, reading 9.1/9.2's
  `listings` table through the shared Supabase client (never `dataProvider`/`EntityList`), grouped
  shadchan/single results, opted-in-fields-only rendering, four render phases (idle/loading/error/
  results), i18n via `publicSearchTranslate.ts`. No schema change. Status → review.
- 2026-08-03 — Review fixes (F1, F2, F3, F4, F5, F6, F9, F11; F7/F8 documented, not code changes):
  `loadPublicListings` now `.select()`s exactly the 13 `anon`-granted columns (a new exported
  `GRANTED_LISTING_COLUMNS` sourced straight from `06_grants.sql`'s own list), never `"*"` — the
  page was previously broken for EVERY anonymous visitor, always, since PostgREST refuses a `"*"`
  expansion for a role with only column-level SELECT (F1, BLOCKING). A new
  `getAnonSupabaseClient()` (`providers/supabase/supabase.ts`) — `persistSession`/
  `autoRefreshToken`/`detectSessionInUrl` all `false` — replaces the shared, session-bearing
  `getSupabaseClient()` singleton in `publicListingsClient.ts`, so a signed-in visitor's browser
  session can no longer silently narrow `/find`'s results to their own account (F2, HIGH). A new
  `PublicListing` type (`Pick<Listing, ...GRANTED_LISTING_COLUMNS>`) replaces `Listing` on the
  client/card/page boundary, so `account_id`/`single_id`/`published_by_member_id` are a compile
  error here rather than a silent type-assertion mismatch (F11). The pinned unit test
  (`expect(calls.select).toEqual([["*"]])`) now asserts the real granted-column list, imported
  from source so it cannot re-drift (F3). A new test proves NO `card-content` block mounts when
  every optional field on both listing shapes is null — the prior test only ruled out one known
  placeholder string, which a mutation like `"Area not specified"` sailed past (F4). A new
  `src/App.test.tsx` renders the real `App` component (given an injectable `url` prop, mirroring
  `PublicSearchPage`'s own testability pattern) and proves `/find` actually mounts
  `PublicSearchPage` — the previous suite stayed green even with the `App.tsx` branch deleted
  outright (F5). The "no dataProvider/EntityList" source-scan guard also now asserts none of this
  story's six files call `.insert()`/`.update()`/`.upsert()`/`.delete()` (F6/AC-7). `isPublicSearchUrl`
  no longer accepts a trailing-slash `/find/`, which `vite.config.ts`'s `base: "./"` plus
  `vercel.json`'s SPA catch-all rewrite would resolve to a blank page in production (F9). F5 is
  additionally closed at the e2e layer: a new `e2e/public-search.spec.ts` (+ a `createListing`
  fixture in `e2e/fixtures.ts`) drives the real dev server against a real, RLS-enforced e2e
  Supabase stack — one test with no session at all, one signed in as a DIFFERENT account's member
  — and both were mutation-proven live to fail red against the F1 and F2 bugs respectively before
  being confirmed green against the fix (see Completion Notes for the full mutation log). F7
  (search text sits in the request URL) and F8 (an unauthenticated `%`/`_` search returns the
  whole public directory) are addressed as Dev Notes clarifications, not code changes — see
  "Scope notes from the review-fix pass (F7, F8)"; both are the deliberate, correct consequence of
  AD-21 and AC-4's actual scope, not defects. Status stays → review for re-review.
