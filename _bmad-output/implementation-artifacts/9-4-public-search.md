# Story 9.4: Public search

Status: ready-for-dev

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

- [ ] **Task 1 — The public route, following the deleted portal's exact pattern** (AC: 1)
  - [ ] New `src/components/atomic-crm/listings/publicSearchUrl.ts`, mirroring
        `portal/portalToken.ts`'s shape (deleted by Epic 1 Story 1.4, but its pattern is the
        precedent to follow): a `PUBLIC_SEARCH_PATH = "/find"` constant and an
        `isPublicSearchUrl(url): boolean` predicate. **Use a plain pathname, not a URL fragment**
        — unlike the portal's token, a search query has no secret to protect from server logs;
        it is meant to be shareable and bookmarkable (e.g. `?q=...`), which a fragment would
        defeat (Vercel would never see it, but neither would a shared link's copy-paste
        destination reliably reconstruct client-side state across a fresh page load the way a
        query param does). State this contrast explicitly in the component's doc comment so a
        future reader does not "fix" it to match the portal's fragment convention by mistake.
  - [ ] `src/App.tsx`: add the check **before** `<LandingGate>`, exactly where the deleted
        `isPortalUrl(window.location)` check used to sit (per Epic 1 Story 1.4's removal and
        Story 1.5's note that `App.tsx`'s portal-routing block is 1.4's to delete — this story is
        the first to add a new pre-CRM route back):
        ```tsx
        if (isPublicSearchUrl(window.location)) {
          return <PublicSearchPage />;
        }
        ```
  - [ ] Name choice: `/find`, not `/search` — Epic 4 Story 4.5 ("Global search") is an
        **authenticated**, in-app search across a user's own account. Two different features
        named "search" in the same codebase, one public and one private, is exactly the kind of
        ambiguity `.claude/rules/coding-style.md`'s naming guidance and AD-23's "no misdescriptive
        name" spirit warn against — pick the name that cannot be confused with the other feature
        rather than disambiguating later.

- [ ] **Task 2 — Data access: direct Supabase client, not the react-admin `dataProvider`**
      (AC: 1, 2, 3, 7)
  - [ ] `listings/publicListingsClient.ts` — mirrors `portal/portalClient.ts`'s shape exactly: a
        small async function using `getSupabaseClient()` (the same client the rest of the app
        uses; with no session it is already effectively `anon` at the Postgres level — no second
        client instance needed). `loadPublicListings(query: { text?: string; type?: ListingType })
        => Promise<Listing[]>` runs `getSupabaseClient().from("listings").select("*")...` with an
        `ilike`/`textSearch` filter over the opted-in text fields, never a raw SQL string built
        from user input (parameterize through the Supabase query builder throughout).
  - [ ] **Do not use the `EntityList` framework (Epic 4 Story 4.1) or the ra-core `dataProvider`
        here.** Both are built for, and assume, the authenticated `<Admin>` tree
        (`ResourceContextProvider`, the registered `dataProvider`, `i18nProvider` context) that
        this page deliberately renders outside of — exactly the same reason
        `ChildPortalPage.tsx` called `getSupabaseClient()` directly instead of going through
        `dataProvider.getList`. Reusing `EntityList` here would either silently fail (no context
        to read from) or require wrapping this public page in enough of `<Admin>` to defeat the
        entire point of keeping it outside the authenticated tree.
  - [ ] No query, result, or interaction on this page is written to any table or sent to any
        analytics call with identifying detail (AC-4) — if the codebase's PostHog wiring
        auto-instruments page views, confirm this route either is excluded or captures no query
        text/listing identifiers, and say explicitly in the PR which it is.

- [ ] **Task 3 — Components** (AC: 1, 2, 5, 6)
  - [ ] `listings/PublicSearchPage.tsx` — the page shell, styled with no app chrome, following
        `ChildPortalPage.tsx`'s `PortalShell`-style pattern (a calm, centered, unauthenticated
        surface — copy the visual language, not the component, since the portal component itself
        is deleted by Epic 1 before this story starts). Accepts injectable `url` and
        `loadListings` props for testability, exactly as `ChildPortalPageProps` did.
  - [ ] `listings/ShadchanListingCard.tsx` and `listings/SingleListingCard.tsx` — one component
        per listing shape (AC-5), each rendering **only** the fields present (non-`null`) on the
        row it is given — never a placeholder for an absent field (AD's "never fabricate"
        posture, carried into the public surface).
  - [ ] Loading / empty / error states (AC-6) as three distinct, testable render branches in
        `PublicSearchPage.tsx` — not a single generic "something went wrong" catch-all.
  - [ ] Responsive at 375px, light and dark (`UX-DR11`) — this is a fully public page, so it is
        also the product's first impression for a visitor with no account; hold it to the same
        bar the rest of the app's screens are held to.

- [ ] **Task 4 — Tests** (AC: all)
  - [ ] `listings/PublicSearchPage.test.tsx` — mirrors `ChildPortalPage.test.tsx`'s shape: inject
        a fake `loadListings` and a fake `url`, assert the loading/empty/error/populated
        branches render correctly, and assert **no** `dataProvider` or `EntityList` import
        appears anywhere in this file's dependency chain (a simple `grep`/lint check in the test
        file's own setup is enough — the point is to catch a future contributor reaching for the
        familiar framework by habit).
  - [ ] `listings/publicSearchUrl.test.ts` — `isPublicSearchUrl` correctness (query params
        present/absent, trailing slash, wrong path).
  - [ ] `listings/publicListingsClient.test.ts` — the query builder call shape, and that a
        withdrawn/never-published record is absent purely because the underlying `anon`-visible
        table has no such row (this test can run against FakeRest's `listings` resource, seeded
        and un-seeded, rather than requiring the live Postgres suite — no new RLS is added by
        this story, so `supabase/tests/listings.sql` needs no new checks here).
  - [ ] `src/App.test.tsx` (or wherever the existing landing/portal routing was tested before
        Epic 1 deleted the portal) gets a case for the new pre-CRM branch, matching however
        `isPortalUrl`'s branch was tested.
  - [ ] `make typecheck && npm run lint && make test`, plus `npx prettier --check` on this
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
(9.2) offers up to seven: first name (en/he), age, height, community, location, summary, plus a
gated photo. `ShadchanListingCard` and `SingleListingCard` should each be simple, presentational,
and take a `Listing` (from `types.ts`, already carrying both branches' columns per 9.1 Task 5) —
branch on `listing_type` once, at the top of `PublicSearchPage.tsx`, to choose which card to
render per row, rather than either card trying to handle both shapes internally.

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

### Migration workflow

None — this story ships no schema change.

### Testing standards

AAA structure, descriptive names, isolated fixtures [Source: .claude/rules/testing.md]. This
story's tests are pure frontend (Vitest + Testing Library, `FakeRest` for the client test) — no
`npm run test:unit:db` addition, consistent with "no schema change" above.

### Project Structure Notes

- All new files in `src/components/atomic-crm/listings/`, alongside 9.1's and 9.2's components
  (`PublicSearchPage.tsx`, `ShadchanListingCard.tsx`, `SingleListingCard.tsx`,
  `publicSearchUrl.ts`, `publicListingsClient.ts`).
- `src/App.tsx` gains one new pre-`<LandingGate>` branch — keep the file's existing shape
  (early-return pattern), do not restructure the surrounding portal-removal diff from Epic 1.
- English-only in all committed content [Source: .claude/rules/english-only.md].

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-9.4-Public-search]
- [Source: amendment-a2.md#A2.5] — FR106, PRV-13 ("never reveals who is researching whom")
- [Source: ARCHITECTURE-SPINE.md#AD-21] — listings snapshot, the data this story reads
- [Source: ARCHITECTURE-SPINE.md#AD-24] — `Entity360`/`EntityList` are the authenticated shell's contract, not a universal one
- [Source: 9-1-publish-shadchan-listing.md] / [9-2-publish-single-listing.md] — the table, grants, and field sets this story renders
- [Source: src/App.tsx] — the pre-CRM routing pattern this story extends (portal precedent, deleted by Epic 1 Story 1.4)
- [Source: src/components/atomic-crm/portal/portalClient.ts, ChildPortalPage.tsx] (pre-1.4 state) — the direct-Supabase-client pattern this story follows for an unauthenticated page
- [Source: 1-4-retire-token-portal.md] — confirms the portal and its `App.tsx` wiring are gone before this story starts, and that FR107 (not FR106) is what it explicitly hands to Epic 9
- [Source: .claude/rules/security-triggers.md] — user-input-to-query review trigger
- [Source: _bmad-output/planning-artifacts/epics.md#Story-4.5-Global-search] — the authenticated feature this story's naming must not collide with

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
