---
baseline_commit: 993ae25c2e4dce236410b7b7c5e27b2b79801ec6
---

# Story 10.1: Share-target completion

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want to share a message straight into the app,
so that I file it while I remember — whatever channel it came from, whatever it is
(text, WhatsApp, SMS, or a photo of a resume).

## Position in Epic 10

Independent of **10.3** (email ingress) — different channel, disjoint files. **10.2**
(ambiguous sender attribution) depends on **this story landing first**: 10.2 adds a
"needs confirmation" badge to `InboxResolveDialog.tsx`, which this story refactors and
extends first (see Dependencies).

Runs on the **post-Epic-1 / post-Epic-2** codebase: `children` is `singles`, `child_id`
is `single_id`, `sales` is `members`, and `current_account_id()` is gone — RLS reads
`current_context_id()` (AD-19). This story never touches RLS directly; it relies on the
existing account-scoped policies on `inbox_items`, `shidduchim`, `shadchanim`,
`singles`, and `interactions`.

## Acceptance Criteria

1. **A shared photo reaches the app, not just shared text.** On Android (installed
   PWA), sharing an image (from WhatsApp, the Photos app, or anywhere else) via the OS
   share sheet lands in MyShadchan with the image intact — not just title/text/url.
   `public/manifest.json`'s `share_target` is Web Share Target API **Level 2**: `method:
   "POST"`, `enctype: "multipart/form-data"`, a `files` param. A service worker fetch
   handler intercepts the POST (a static HTML page cannot receive a POST body), stores
   the shared file(s) client-side, and hands off to the existing SPA route. Text-only
   shares (WhatsApp/SMS, FR27/FR28) keep working through the same POST path — the old
   GET-based query-string flow **and its `public/share-target.html` shim** are deleted,
   not kept alongside it (NFR-14).

2. **The landing screen lets me set the source.** `ShareTarget.tsx` no longer
   auto-files with a hardcoded `source: "whatsapp"` and redirect. It renders three
   source choices — WhatsApp / SMS / Photo — defaulting to "Photo" when a file was
   shared, "WhatsApp" otherwise, changeable before saving.

3. **I can resolve which shadchan sent it.** A typeahead search over my shadchan book
   (`ReferenceInput reference="shadchanim"`, the same component `ShidduchInputs.tsx`
   already uses) lets me pick one. Not found → an inline "+ Add a shadchan" affordance
   creates one without leaving the screen (FR78's "not found → add the shadchan
   inline").

4. **I can resolve which single it's for.** A picker over my household's singles
   (`singles` — post-1.3 rename) lets me choose one when I have more than one; a
   household with exactly one single needs no picker (nothing to disambiguate).

5. **I can attach it to an existing suggestion instead of creating a new one.** A
   search over my account's own suggestions (`useGetList("shidduchim", { filter: { q } })`
   — Story 4.3's full-text entry, routed through `shidduchim_summary` by the
   dataProvider) shows matches with their pipeline state; picking one links the
   captured content to that suggestion as an update — it does **not** create a second,
   duplicate suggestion. This capability is added once, to a **shared resolve module**,
   and used by both this screen and the existing `InboxResolveDialog.tsx` — not
   duplicated (AD-4's single-creation-path rule extends here: there must be one place
   that decides "new suggestion vs. update to an existing one", not two divergent
   copies).

6. **Skipping never loses it.** A "Skip — drop it in my Inbox" action is always
   available and behaves exactly as today: an `unresolved` `inbox_items` row, visible
   in the Inbox for later triage.

7. **Nothing here creates a suggestion outside `createShidduch()`.** Whether I resolve
   at share-time or later from the Inbox, the only way a new suggestion is created is
   the existing `createShidduch()` RPC (AD-4); "link to an existing suggestion" writes
   an `interactions` row (`kind: 'note'`) against the chosen `shidduchim` row, the same
   values `entity360/tabs/NotesTab.tsx`'s `AddNoteForm` already inserts (`target_type:
   "shidduch"`, `kind: "note"`, `scope: "shidduch"`, `reference_link_id: null`) —
   never a bespoke insert, and reused through the shared helper Task 2 extracts (see
   Task 2 — `NotesTab.tsx` documents itself as the sole note-writer, so this capture
   path must go through the same function, not stand up a second one).

8. **Cross-account isolation holds.** The shadchan search, the single picker, and the
   "link to an existing suggestion" search only ever return rows from my own account
   (enforced by existing RLS on `shadchanim`, `singles`, `shidduchim_summary` — no new
   policy needed here). **Negative test:** a member of account A can search, but never
   see or link to, a suggestion belonging to account B.

## Tasks / Subtasks

- [x] **Task 1 — Web Share Target Level 2 (files)** (AC: 1)
  - [x] `public/manifest.json`: replace the `share_target` block —
        `"action": "/share-target"`, `"method": "POST"`, `"enctype":
        "multipart/form-data"`, `"params": {"title": "title", "text": "text", "url":
        "url", "files": [{"name": "files", "accept": ["image/*"]}]}`.
  - [x] `vite.config.ts`: switch the `VitePWA()` plugin from the default `generateSW`
        strategy to `strategies: "injectManifest"`, `srcDir: "src"`, `filename:
        "sw.ts"`; move the current `workbox.globPatterns` /
        `maximumFileSizeToCacheInBytes` values into the `injectManifest: {}` option
        (that's where they live under this strategy).
  - [x] **Do not drop `workbox.importScripts: ["push-sw.js"]` in this switch.** That
        line (`vite.config.ts:60`, added by Story 7.5) is the only wiring for
        `public/push-sw.js`'s `push`/`notificationclick` listeners under the current
        `generateSW` strategy; `injectManifest`'s config has no `importScripts` option
        of its own, so simply deleting the `workbox: {}` block silently kills
        Epic 7's push notifications on every next deploy with nothing failing loudly.
        Port both listeners forward instead: either add
        `importScripts("/push-sw.js")` as the first line of the new `src/sw.ts` (same
        mechanism, new host file), or inline the two listener bodies directly into
        `src/sw.ts`. Either way, `public/push-sw.js` keeps shipping (Vite's `public/`
        copy is unaffected by this switch) and its listeners keep firing.
  - [x] New `src/sw.ts`: `precacheAndRoute(self.__WB_MANIFEST)` (workbox-precaching,
        same asset globs `vite.config.ts` configures today), `clientsClaim()` +
        `self.skipWaiting()` on install/activate (autoUpdate's current behavior, now
        explicit since `injectManifest` doesn't wire it for you), the ported
        `push`/`notificationclick` listeners (bullet above), and a `fetch`
        listener: when `event.request.method === "POST"` and the URL path is
        `/share-target`, `event.respondWith(...)` a handler that reads
        `await event.request.formData()`, stores any `files` entries in the Cache API
        under a per-share key (e.g. `caches.open("share-target-inbox")`,
        `cache.put(key, new Response(file))`), and returns
        `Response.redirect("/#/share?title=…&text=…&url=…&shareKey=" + key, 303)`
        built from the form fields (URL-encode each).
  - [x] Delete `public/share-target.html`: the SW now 303-redirects straight to
        `/#/share?…`, so the GET shim has no remaining caller (its only references are
        `manifest.json` and the file itself — verified). NFR-14: the replaced thing is
        deleted in the same change; share sheets only target an installed PWA, whose
        SW is registered, so no non-SW fallback path is kept.
  - [x] `ShareTarget.tsx`: when `shareKey` is present, open
        `caches.open("share-target-inbox")`, read the stored file(s), and delete the
        cache entry once read (so a page refresh doesn't re-import stale files).

- [x] **Task 2 — Extract the shared resolve module** (AC: 5, 7)
  - [x] New `src/components/atomic-crm/inbox/useResolveInboxItem.ts` exporting three
        functions, each taking the `InboxItem` plus its specific input:
        - `resolveAsNewShidduch(item, input: CreateShidduchInput)` — calls
          `dataProvider.createShidduch(input)`, then `dataProvider.update("inbox_items",
          {id: item.id, data: {status: "resolved", resolved_shidduchim_id: created.id,
          single_id: input.single_id, shadchan_id: input.shadchan_id ?? null},
          previousData: item})` — the exact sequence `InboxResolveDialog.tsx` inlines
          today (`origin: "channel"`).
        - `resolveAsLinkToExisting(item, shidduchimId: Identifier)` — inserts the
          `interactions` row (`target_type: "shidduch"`, `target_id: shidduchimId,
          kind: "note", scope: "shidduch", reference_link_id: null, body:
          item.raw_text, metadata: {source: "inbox_item", inbox_item_id: item.id}`),
          then `dataProvider.update("inbox_items", {id: item.id, data: {status:
          "resolved", resolved_shidduchim_id: shidduchimId}, previousData: item})`.
          **`entity360/tabs/NotesTab.tsx`'s own doc comment calls it "the ONLY place
          a note is added, edited or soft-deleted"** (Story 5.1) — `ShidduchTimeline.tsx`,
          the file an earlier draft of this story pointed at, does not exist (deleted
          along with the routed-dialog timeline it lived in; `NotesTab.tsx` is its
          generalised replacement). Calling `dataProvider.create("interactions", …)`
          straight from this new module would make it a **second** writer, silently
          contradicting that invariant. Instead: extract the insert itself into a
          tiny shared helper — e.g. `entity360/tabs/insertNoteInteraction.ts`
          exporting `insertNoteInteraction(dataProvider, targetType, targetId,
          body, metadata?)` — that both `NotesTab.tsx`'s `AddNoteForm.handleAdd` and
          this function call. Update `NotesTab.tsx`'s comment to name the helper as
          the sole writer (not the tab component itself). Do not leave the citation
          pointing at a deleted file, and do not add a second, divergent insert path.
        - `dismissInboxItem(item)` — the existing dismiss update.
  - [x] Refactor `InboxResolveDialog.tsx`'s `onSubmit`/`onDismiss` to call these
        instead of inlining the logic (behavior unchanged for the existing "create a
        new suggestion" path).

- [x] **Task 3 — "Link to an existing suggestion" search, on both surfaces** (AC: 5, 8)
  - [x] Reuse Story 4.3's search entry (Epic 4 lands before this epic): `{ resource:
        "shidduchim", beforeGetList: applyFullTextSearch([...]) }` in
        `providers/supabase/dataProvider.ts`'s `lifeCycleCallbacks` — keyed to
        `"shidduchim"`, **not** `"shidduchim_summary"` (an entry keyed to the summary
        name never fires for `getList("shidduchim")`; 4.1/4.3 document why). Do not
        add a second entry; if 4.3's entry is genuinely absent, this task is blocked
        on 4.3, not a place to re-add it.
  - [x] New small component (e.g. `inbox/LinkToShidduchSearch.tsx`): a search input
        querying `useGetList("shidduchim", ...)` with the `q` filter (the custom
        `getList` routes it through `shidduchim_summary`), rendering
        each match's `name_en` + a pipeline-state label (reuse `PIPELINE_STATES` from
        `shidduchim/pipelineStates.ts` for the label/token, matching the mockup's
        "Look-into · already on the board") with a "Link" button calling
        `resolveAsLinkToExisting`.
  - [x] Add this component to `InboxResolveDialog.tsx` (below the existing
        `ShidduchInputs` form, as an alternative to submitting it) **and** to the new
        `ShareTarget.tsx` screen (Task 4).

- [x] **Task 4 — `ShareTarget.tsx` becomes the resolve screen** (AC: 2, 3, 4, 6)
  - [x] Replace the current auto-file-and-redirect `useEffect` with a rendered screen:
        source tabs (WhatsApp/SMS/Photo — a plain three-way toggle, no new resource),
        a preview of the raw text or image(s), a `ReferenceInput
        source="shadchan_id" reference="shadchanim"` + `AutocompleteInput` (with
        `onCreate` wired to `dataProvider.create("shadchanim", {data: {name: filter}})`
        for the inline "+ Add a shadchan" case), a pill picker over `useGetList("singles")`
        for `single_id` (rendered only when there is more than one), the
        `LinkToShidduchSearch` from Task 3, and two actions: "Save" (creates the
        `inbox_items` row first via the existing `dataProvider.create("inbox_items",
        {data: {source, raw_text, attachments, status: "unresolved"}})` call, then
        immediately calls `resolveAsNewShidduch` or `resolveAsLinkToExisting` with the
        chosen inputs) and "Skip — drop it in my Inbox" (creates the bare unresolved
        row exactly as the current implementation does, then navigates to
        `/inbox_items`).
  - [x] Photo shares: upload the shared file(s) with the provider's existing
        `uploadToBucket` helper (`providers/supabase/dataProvider.ts:1244` — it
        already handles `blob:`/`data:` sources). **It is not exported today** (a
        module-private `const`, used only internally at `:1049`) — add `export` to
        its declaration in this same diff, or any file that imports it fails `tsc`.
        Write `inbox_items.attachments` entries
        in the **same `{title, type, path, src}` shape the email webhook writes**
        (`postmark/extractAndUploadAttachments.ts`) — one attachment shape across
        channels (AD-6), one renderer (10.3's Inbox attachment rendering task).
  - [x] Wrap the form portion in `<Form>` (ra-core) so `ReferenceInput`/
        `AutocompleteInput` have the RHF context they require — same pattern
        `InboxResolveDialog.tsx` already uses.
  - [x] Update `ShidduchInputs.tsx`'s `shadchan_id` `AutocompleteInput` to also accept
        `onCreate` (it doesn't today) so the inline-create affordance is consistent
        wherever `ShidduchInputs` is reused (manual "Add a suggestion" too — a
        low-risk, additive change, not a new component).

- [x] **Task 5 — Tests** (AC: all)
  - [x] Unit tests for `useResolveInboxItem.ts`'s three functions (mock
        `dataProvider`), following the AAA pattern in `.claude/rules/testing.md`.
  - [x] **Build-output guard for the push listener (Task 1).** After `npm run build`,
        assert the emitted `dist/sw.js` contains a `push` event listener (e.g. read
        the file and assert it matches `/addEventListener\(\s*["']push["']/`). No
        existing test would catch the `injectManifest` switch silently dropping
        `importScripts: ["push-sw.js"]` — this is the assertion that would.
  - [x] `e2e/share-target.spec.ts` (new — per `e2e-conventions`, this touches UI/forms):
        simulate a share landing (navigate directly to `/#/share?...` with a `shareKey`
        pre-seeded via `page.evaluate` writing to the Cache API, since Playwright
        cannot drive the real Android share sheet), resolve a shadchan + single, save,
        and assert a new suggestion appears on the board. A second test: skip, and
        assert the item appears unresolved in `/inbox_items`.
  - [x] **Negative test (AC 8):** in `e2e/share-target.spec.ts`, seed two accounts
        each with one suggestion; signed in as a member of account A, type account
        B's suggestion name into `LinkToShidduchSearch` and assert the result list is
        empty (row-level isolation of `shidduchim` itself is Epic 2's SQL-suite
        territory; this asserts the new search surface passes no cross-account rows
        through).

## Dev Notes

### Why this is scoped this way

FR27/FR28 ("share-target: any messaging app," "SMS captured by Share") and FR78
("optional quick-link at capture") are this epic's stated coverage
[Source: _bmad-output/planning-artifacts/epics.md#Requirements-Inventory]. AD-6 names
the exact mechanism: *"Optional quick-link at capture (FR78): the share flow can let
the user search the shadchan book (typeahead) and select the candidate and/or attach to
an existing suggestion — one tap, fully skippable straight to the unfiled Inbox."*
[Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-6]. The mockup (`mockup/MyShadchan.dc.html:529-599`,
`isShare` screen) is the concrete UX this story implements: source tabs, "Which
shadchan?" with a detected/typeahead field and inline add, "Which child?" (single)
pills, "Or link to an existing suggestion" with a search list, "Save & review" /
"Skip." `gap-analysis-v3.md`'s P1 backlog item #7, *"Share-target: source tabs,
attribution, link to existing suggestion,"* is this story verbatim.

**Why "link to an existing suggestion" is a shared module, not share-screen-only:**
today only `InboxResolveDialog.tsx` exists as a resolve surface, and it has no
link-to-existing capability either — this is a genuinely new capability, not a
share-specific one. AD-4's single-creation-path rule ("one `createSuggestion()` service
= the sole INSERT path") is the same principle that says there must be one place
deciding new-vs-existing, reused by every entry point, not a copy per entry point.

**Why the manifest goes straight to POST (Level 2), not GET+POST both:** the Web App
Manifest spec allows exactly one `share_target` member per manifest. NFR-14 (no
parallel paths) forecloses keeping the old GET action alongside a new POST one even if
it were spec-legal.

### What already exists — reuse, do not rebuild

- `src/components/atomic-crm/inbox/ShareTarget.tsx` — currently auto-files with
  `source: "whatsapp"` hardcoded and redirects; this story replaces its body, keeps
  `ShareTarget.path = "/share"`.
- `src/components/atomic-crm/inbox/InboxResolveDialog.tsx` — the existing "create a new
  suggestion" resolve flow (`createShidduch` + mark-resolved). Refactor its logic into
  the shared module; do not fork a second implementation for the share screen.
- `src/components/atomic-crm/shidduchim/ShidduchInputs.tsx` — the `ReferenceInput` +
  `AutocompleteInput` pattern for `shadchan_id` (→ `shadchanim`) and `single_id` (→
  `singles`, post-1.3) is the existing, shipped typeahead. Reuse it; do not build a
  second autocomplete.
- `src/components/atomic-crm/entity360/tabs/NotesTab.tsx`'s `AddNoteForm` — the exact
  `interactions` insert shape (`target_type: "shidduch"`, `kind: "note"`, `scope:
  "shidduch"`, `reference_link_id: null`, stamped `actor_member_id` via the DB
  trigger, never client-supplied) that "link to an existing suggestion" must reuse, so
  the linked capture shows up in that suggestion's Notes/Activity tab automatically —
  no new rendering path needed on the receiving end. (`ShidduchTimeline.tsx` / the
  routed-dialog `AddNote` an earlier draft named here was deleted by Story 5.1;
  `NotesTab.tsx` is its generalised, single-writer replacement — see Task 2.)
- `src/components/admin/autocomplete-input.tsx` already supports `create`/`onCreate`
  (verified: it wires both into `useSupportCreateSuggestion`) — use the prop, don't
  hand-roll a create-inline dialog from scratch.
- `inbox/inboxMeta.ts` (`INBOX_SOURCE_META`, `INBOX_PRIMARY_CTA_CLASS`) — the existing
  source icon/label map and the app's one primary-CTA gradient class. The new source
  tabs and Save button should read from/use these, not introduce new styling.

### Web Share Target Level 2 — why a service worker is unavoidable

A `share_target` with `method: "POST"` delivers the shared payload as an HTTP POST with
a `multipart/form-data` body. A static HTML page (`share-target.html`'s current GET
shim) cannot read a POST body — only a service worker's `fetch` event handler, or a
real server, can. Since this is a static Vite SPA with no server in the request path
for `/share-target`, the service worker is the only place to intercept it. This is why
`vite.config.ts`'s `VitePWA()` must move from `generateSW` (auto-generated, no room for
custom fetch handlers) to `injectManifest` (a hand-written `src/sw.ts` that still gets
the precache manifest injected). iOS Safari does not support Web Share Target at all —
the photo-via-share path is Android-only by design; iPhone photo capture already goes
through the email channel (FR28, Story 10.3), so there is no gap to cover there.

### Project Structure Notes

- New files: `src/sw.ts`, `src/components/atomic-crm/inbox/useResolveInboxItem.ts`,
  `src/components/atomic-crm/inbox/LinkToShidduchSearch.tsx`,
  `src/components/atomic-crm/entity360/tabs/insertNoteInteraction.ts` (Task 2),
  `e2e/share-target.spec.ts`.
- Modified: `public/manifest.json`, `vite.config.ts`,
  `src/components/atomic-crm/inbox/ShareTarget.tsx`,
  `src/components/atomic-crm/inbox/InboxResolveDialog.tsx`,
  `src/components/atomic-crm/shidduchim/ShidduchInputs.tsx`,
  `src/components/atomic-crm/entity360/tabs/NotesTab.tsx` (Task 2 — routes through
  the new shared helper, updates its sole-writer comment),
  `src/components/atomic-crm/providers/supabase/dataProvider.ts` (Task 4 — export
  `uploadToBucket`), `registry.json` (generated — the new `inbox/` and `entity360/`
  files land under the glob `scripts/generate-registry.mjs` scans; `make
  registry-gen` regenerates it, but declare it so the diff isn't a surprise),
  `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` and
  `frenchCrmMessages.ts` (new user-facing strings: source tabs, "+ Add a shadchan",
  "Skip — drop it in my Inbox", the pipeline-state labels surfaced in
  `LinkToShidduchSearch` — `frenchCrmMessages.ts` ends `satisfies CrmMessages`, so a
  missing French twin is a `make typecheck` failure, not a silent gap).
- Deleted: `public/share-target.html` (Task 1).
- No schema change, no migration. No `dataProvider.ts` change beyond exporting the
  existing `uploadToBucket` (Task 3 reuses 4.3's search entry). No FakeRest changes:
  `inbox_items`, `shadchanim`, `singles` are plain CRUD there; `interactions` carries
  `assertValidInteraction` guards mirroring the DB constraints, which the
  AddNoteForm-shaped insert (target_type `shidduch`, scope `shidduch`, no
  `reference_link_id`) already satisfies; `createShidduch` is untouched.

### Testing standard

AAA pattern, descriptive names, ≥80% coverage on new code
(`.claude/rules/testing.md`). Any UI/form/interaction change requires an
`e2e/*.spec.ts` (`e2e-conventions` skill) — this story adds one. Use
`playwright-testing` conventions: user-visible locators, deterministic waits, no
`waitForTimeout`. `.claude/rules/security-triggers.md` applies and was missing from
an earlier draft of this story: Task 1 adds a service-worker `fetch` handler that
intercepts an OS-share POST body (user input handling), stores untrusted binary
content in the Cache API (file-system-adjacent storage), and Task 4 adds an upload
path with no server-side content-type/size validation on the shared file(s).
Dispatch SECURITY-REVIEWER on this diff at implementation time.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-10-Capture-Funnel-Completion]
  — Story 10.1's stated AC.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-6] — the quick-link-at-capture rule, and "channel
  ingestion is rate-limited against flooding" (AD-17) — out of scope here, already
  covered app-wide, not re-litigated per story.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-4] — one `createSuggestion()`/`createShidduch()`
  path; the rationale for the shared resolve module.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-24] — Epic 3 lands before this epic, so
  `RecordLink` (Story 3.9) exists. It is a navigation anchor (a `<Link>` to the
  record); the picker rows here are **selection** controls ("Link" files the capture
  and must not navigate away mid-share), so they are not record mentions and stay
  plain rows. Use `RecordLink` wherever these surfaces *mention* an already-filed
  record navigably.
- [Source: mockup/MyShadchan.dc.html#L529-599] — the `isShare` screen this story
  implements.
- [Source: design-artifacts/gap-analysis-v3.md#9-Prioritised-backlog] — P1 item 7.
- [Source: _bmad-output/implementation-artifacts/1-3-rename-children-to-singles.md] —
  the post-rename names (`singles`, `single_id`) this story is written against.

## Dependencies

- **Epic 1** (1.1–1.6) landed: `singles`/`single_id`, `members`, no token portal.
- **Epic 2** (2.1–2.2 at least): `current_context_id()` scoping in place — this story
  writes no new RLS but every read/write here runs under it.
- **Epic 3 (3.9)**: `RecordLink` exists — see References for why the picker rows
  deliberately don't use it.
- **Epic 4 (4.3)**: the `"shidduchim"`-keyed full-text search entry Task 3 reuses.
- **10.2 depends on this story landing first** — 10.2 adds a "needs confirmation"
  badge to `InboxResolveDialog.tsx`, which this story refactors. Land this one first to
  avoid a rebase.
- No dependency on **10.3** (disjoint files: email/postmark vs. share-target/inbox UI).

## Dev Agent Record

### Agent Model Used

Claude (Sonnet 5), via the bmad-dev-story workflow.

### Debug Log References

- `make typecheck` — 2026-08-03T14:40Z — clean (both before and after the
  Cache-API key fix described below).
- `make lint` — 2026-08-03T14:39Z — clean (ESLint 0 errors/0 warnings,
  Prettier clean) after fixing prettier formatting on `src/sw.ts`,
  `ShareTarget.tsx`, `LinkToShidduchSearch.tsx` (pre-existing from the prior
  agent) and on the new `InboxResolveDialog.tsx`/`e2e/share-target.spec.ts`
  edits.
- `npx vitest run` — 2026-08-03T14:40:53Z — 284 files / 3424 tests, all
  green. One earlier run (14:20Z, and again at 14:39Z) showed a single
  failure in `threads/usePushSubscription.test.tsx` ("settles into the error
  state instead of hanging on 'subscribing' forever") — re-ran that file in
  isolation (green in 1.07s) and the full suite a second time (green,
  58.27s/43.98s) to confirm it is a timing flake under this session's
  machine load, not a regression: nothing in this story's file set touches
  push subscriptions.
- `make build` — 2026-08-03T14:41:48Z — clean; `verify-push-sw-build.mjs`
  passed ("push-sw.js shipped and wired into sw.js").
- **Guard-integrity check (per the amendment):** deliberately replaced
  `src/sw.ts`'s `importScripts("push-sw.js")` call with a comment, ran
  `npx vite build`, then `node scripts/verify-push-sw-build.mjs` — it failed
  exactly as intended: `dist/sw.js does not call
  importScripts("push-sw.js") — the push listener did not ship wired in`.
  Restored the file, rebuilt, and confirmed the guard passes again. The
  guard is proven to actually catch the regression it exists for, not just
  reported as passing.
- Four CI guards (`check-retired-names`, `check-route-convention`,
  `check-suppressions`, `check-tailwind-arbitrary-var`) — 2026-08-03T14:41Z —
  all "OK", exit 0.
- `make test STACK_ID=4` — 2026-08-03T14:42:51Z — 284 files / 3424 tests
  green, against the real stack-4 Supabase/Postgres instance (includes the
  `db` project).
- `npx prettier --check .` — 2026-08-03T14:43:02Z — 16 pre-existing
  formatting warnings in `.github/workflows/*`, `.lintstagedrc`, and
  `doc/**/*.mdx`. Verified pre-existing per `.claude/rules/gate-verification.md`:
  ran the identical command against a clean `git archive` snapshot of the
  baseline commit `993ae25` — same 16 files, byte-for-byte. None are in this
  story's file set.
- **e2e (not part of the story's required gate list, but run for real
  verification since I had `STACK_ID=4` available):**
  `STACK_ID=4 npx playwright test e2e/share-target.spec.ts` — all 6
  tests (3 tests × chromium/Mobile Chrome) green, twice in a row for
  stability. The first run caught a real bug (see Completion Notes).
- No SQL touched by this story — `supabase db diff --local` and
  `make check-migration-safety` were not applicable.

### Completion Notes List

- **Found and fixed a real production bug via the new e2e coverage, not
  invented by this story's own changes but exposed by finishing them:** the
  prior agent's `src/sw.ts` and `ShareTarget.tsx` both keyed the Cache API
  with a bare `` `${shareKey}:manifest` `` / `` `${shareKey}:${index}` ``
  string. The real Cache API (`cache.put`/`cache.match`) parses a string key
  as an absolute URL, and a v4 UUID's characters (hex digits + hyphens) are
  all valid URL-scheme characters — so Chrome read the whole UUID as the
  scheme of `"<uuid>:manifest"` and rejected it: `Failed to execute 'put' on
  'Cache': Request scheme '<uuid>' is unsupported`. No unit test could catch
  this because it requires a real browser's URL parser, not a mock — exactly
  what `e2e/share-target.spec.ts`'s "a shared photo…" test is for. Fixed by
  prefixing both files' copies of the key format with a leading `/`
  (`` `/share-target-inbox/${shareKey}/manifest` ``), which resolves as a
  path reference instead of an absolute URL. Both copies (and the test's own
  third copy, per the files' existing "keep in sync" convention) were
  updated together.
- **Completed unfinished Task 2/Task 3 work left in the working tree:**
  `InboxResolveDialog.tsx` had NOT yet been refactored to call
  `useResolveInboxItem`'s functions (it still inlined the `createShidduch` +
  `update` sequence and its own `dismiss` update), and it had no
  `LinkToShidduchSearch` wired in at all. Refactored `onSubmit`/`onDismiss`
  to call `resolveAsNewShidduch`/`dismissInboxItem` (behavior unchanged —
  `InboxResolveDialog.test.tsx`'s existing assertions on `createShidduch`'s
  call args still pass unmodified), added a `handleLinkToExisting` calling
  `resolveAsLinkToExisting`, and added the shared `LinkToShidduchSearch`
  component below `ShidduchInputs` in the dialog's form, per Task 3. This
  also removed a now-dead `useDataProvider<CrmDataProvider>()` call and its
  imports.
- **Added the missing i18n catalog entries** (`crm.inbox.share.*`,
  `crm.inbox.linkSearch.*`) to both `englishCrmMessages.ts` and
  `frenchCrmMessages.ts` — the Dev Notes' "Project Structure Notes" called
  these out explicitly (`frenchCrmMessages.ts` ends `satisfies CrmMessages`,
  so a missing French twin would be a `make typecheck` failure the moment a
  key is added to English). Did **not** add catalog entries for the
  `whatsapp`/`sms`/`photo` source-tab labels — `inbox/inboxMeta.ts`'s own
  header comment documents that only the `shadchan` source ever got a real
  catalogue entry and the other five intentionally fall back to their plain
  literal label in every locale; this story doesn't change that.
- **Wrote and verified `e2e/share-target.spec.ts`** (previously missing —
  Task 5's bullet for it was unchecked and the file did not exist). Three
  tests: a shared photo (via a Cache-API-seeded `shareKey`, since Playwright
  cannot drive the real Android share sheet) resolving into a new suggestion
  with a shadchan credited (AC 1/2/3/4); skip-to-Inbox (AC 6); and
  cross-account isolation of the `LinkToShidduchSearch` search (AC 8, the
  story's required negative test). Ran it for real against the `STACK_ID=4`
  stack — not merely written on faith — specifically because writing it is
  what surfaced the Cache-API bug above. The cross-account search needed a
  15s (not the default 5s) visibility timeout under this session's machine
  load; matches the existing `fetchOtpCode` convention in `e2e/fixtures.ts`
  for the same reason.
- Fixed pre-existing Prettier formatting issues in `src/sw.ts`,
  `ShareTarget.tsx`, and `LinkToShidduchSearch.tsx` (left over from the
  prior agent's session) and in my own new/edited
  `InboxResolveDialog.tsx`/`e2e/share-target.spec.ts`.
- Regenerated `registry.json` (`make registry-gen`) so it includes
  `LinkToShidduchSearch.tsx`, `useResolveInboxItem.ts`, and
  `insertNoteInteraction.ts`.
- Did not touch anything outside the story's declared file set. The
  `.claude/skills/*` untracked directories present in `git status` at
  dispatch are unrelated prior work and were left untouched.

### File List

**Modified:**
- `public/manifest.json`
- `vite.config.ts`
- `src/sw.ts` (new, but continuing the prior agent's file — see note below)
- `src/components/atomic-crm/inbox/ShareTarget.tsx`
- `src/components/atomic-crm/inbox/InboxResolveDialog.tsx`
- `src/components/atomic-crm/inbox/useResolveInboxItem.ts` (new, continuing)
- `src/components/atomic-crm/inbox/LinkToShidduchSearch.tsx` (new, continuing)
- `src/components/atomic-crm/entity360/tabs/NotesTab.tsx`
- `src/components/atomic-crm/entity360/tabs/insertNoteInteraction.ts` (new, continuing)
- `src/components/atomic-crm/shidduchim/ShidduchInputs.tsx`
- `src/components/atomic-crm/providers/supabase/dataProvider.ts`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
- `registry.json` (generated)

**New (written this session):**
- `e2e/share-target.spec.ts`

**New (continuing the prior agent's uncommitted work, verified/adjusted this session):**
- `src/components/atomic-crm/inbox/useResolveInboxItem.test.tsx`

**Deleted:**
- `public/share-target.html`

Committed as `8091252` on `main` (`make commit`, no `--no-verify`, no
`git add -A`).
