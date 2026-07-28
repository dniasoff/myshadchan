# Epic 3 — canonical API contract

**Status:** binding. Every Epic 3 story, and every Epic 4–11 story that touches a 360, a list
row, a record mention or a universal tab, cites **this file** and does not restate the shapes.
A builder must be able to diff their implementation against it.

Anchored to `main`. Source of truth for architecture decisions:
`_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md`
(AD-23 `:174-176`, AD-24 `:177-180`). Source of truth for tabs/routes:
`_bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:158-186`
(UX-DR1–UX-DR11). **`mockup/MyShadchan.dc.html` and `mockup/uploads/ARCHITECTURE-SPINE.md` are
not sources for anything in this contract.**

---

## 0. Global corrections — apply to all 14 stories, no exceptions

| Wrong | Correct |
|---|---|
| `[Source: ARCHITECTURE-SPINE.md#AD-24]` | `[Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-24]` — full path, always. Two files share the bare name; the other one has no AD-22/23/24. |
| `make typecheck` / `make test` | There is **no `Makefile`**. Validation set: `npm run typecheck`, `npx vitest run`, `npm run test:unit:db`, `npm run lint`, `npm run build`. |
| React Testing Library, `screen.queryByText`, `MemoryRouter` | Not dependencies. Use `vitest-browser-react` + `TestMemoryRouter` from `ra-core` in real Chromium. Negative idiom: `await expect.element(screen.getByRole(...)).not.toBeInTheDocument()`. Pattern file: `src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-10,60-72`. |
| `children/`, `ChildShow.tsx`, `ChildCard.tsx`, `ChildProfileHeader` | Deleted by Epic 1. Real: `src/components/atomic-crm/singles/SingleShow.tsx:42` (`SingleProfileHeader`), `singles/SingleCard.tsx`. `scripts/check-retired-names.mjs` fails CI on the old names. |
| `simple-list/SimpleListItem.tsx` | Deleted. Row-click primitive is `src/components/admin/data-table.tsx:23,233` (`useGetPathForRecordCallback`). |
| `sales.administrator` | `public.members.administrator`; TS type `Member`. |
| "Epic 2 has not landed / `current_context_id()` may not exist" | **Dead text — delete, do not retarget.** `current_context_id()` is live at `supabase/schemas/02_functions.sql:201`, 43 uses in `05_policies.sql`; `current_account_id` no longer exists. |
| "child", "candidate", "Suggestion" (user-facing) | AD-23 vocabulary: **shidduch/shidduchim**, **redt**, **shadchan/shadchanim**, **reference**, **single**. A reference links to **many** shidduchim and the UI must show that. |

`src/components/atomic-crm/entity360/` does not exist. Nothing in Epic 3 is built.

---

## 1. `Entity360` — the shell (Story 3.1)

```ts
// src/components/atomic-crm/entity360/Entity360.tsx
export interface Entity360Props {
  breadcrumb?: ReactNode;
  identityHeader?: ReactNode;
  statBand?: ReactNode;
  alertSlot?: ReactNode;
  tabBar?: ReactNode;
  children?: ReactNode;   // tab content
  rightRail?: ReactNode;
}
export function Entity360(props: Entity360Props): ReactElement;
```

Rules:
1. Regions render in **exactly** that order (AD-24 `:180`), whether or not neighbours are
   present. There is no reorder prop, no slot-order prop, no variant prop.
2. All regions optional. An absent region renders **nothing** — no wrapper, no spacer.
3. **No `className` prop. No `...rest`. No `style` prop.** The signature is closed: seven named
   props and nothing else. A consumer that wants different spacing changes `Entity360.tsx`
   for every entity or does not get it.
4. `breadcrumb` and `alertSlot` have no consumer in Epics 4–11 today. They are **reserved**
   (AD-24 names them); keep them, do not delete them, do not repurpose them.
5. Works at 375px, in light and dark, with empty/loading/error content (UX-DR11). The root is
   `flex flex-col`; the right rail is a sibling column at `lg:` and above, stacked below the
   content beneath it.
6. `EntityAvatar` (same story) **may set `backgroundColor` inline** — `--avatar-{0..9}` is a
   dynamic index Tailwind cannot express without a safelist, and the four existing chips all do
   it (`singles/SingleShow.tsx:57-61`, `shadchanim/ShadchanHeader.tsx:32-37`,
   `references/ReferenceShow.tsx:48-53`, `shidduchim/ShidduchShowHeader.tsx:44-49`). The ban on
   inline style covers **layout** properties only. Assert the computed `background-color`
   matches `boardUtils.getAvatarIndex`, not the absence of the string `style=`.

---

## 2. `EntityDescriptor` (Story 3.3a)

```ts
// src/components/atomic-crm/entity360/entityDescriptor.ts
import type { MemberRole } from "../types";   // NEVER re-declared. types.ts:109-110 is the one union.

export type EntityDescriptor<T extends RaRecord = RaRecord> = {
  /** resource name exactly as registered in root/routeManifest.ts (plural, snake_case) */
  name: string;
  /** REQUIRED. Epic 5 flips these from `/{r}/{id}/show` to `/{r}/{id}`, one line each. */
  buildRecordPath: (id: Identifier) => string;
  /** REQUIRED — 4-1 uses it as a `translate` fallback, which needs `string`, not `string | undefined`. */
  label: string;
  icon?: LucideIcon;

  // --- Region renderers. ComponentType, NOT (record) => ReactNode.
  //     They are a component boundary, so they MAY call hooks (useGetOne, useGetList, …).
  //     The descriptor module owns its own data loading; EntityShow never fetches for a region.
  identityHeader?: ComponentType<{ record: T }>;
  statBand?: ComponentType<{ record: T }>;
  rightRail?: ComponentType<{ record: T }>;
  actions?: ComponentType<{ record: T }>;    // rendered INSIDE the identityHeader region
  alertSlot?: ComponentType<{ record: T }>;

  // --- Default composition. Used ONLY when `identityHeader` is absent.
  avatar?: (record: T) => { seed: string | null };
  title?: (record: T) => string;
  meta?: (record: T) => (string | null | undefined)[];

  tabs?: EntityTabDescriptor<T>[];

  /** Tabs this entity WILL have and does not have YET — the canonical keys not in `tabs`.
   *  Declared, never inferred: the conformance validator asserts
   *  `keys(tabs) ∪ pendingTabs === CANONICAL_TAB_SET[name]` as SETS (§3 rule 5), so a
   *  forgotten tab is still caught while a deliberately partial set is legal. Must itself be
   *  in canonical order and drawn from `TabKey` — it is a declaration, not a comment.
   *  A stub descriptor is `tabs: []` + `pendingTabs: <the entity's full canonical set>`;
   *  there is no separate stub-exemption list. The story that builds a tab moves its key
   *  from `pendingTabs` into `tabs` in the same diff. Descriptor metadata only — nothing
   *  renders it, and it is NOT an `Entity360` region (§1 stays at seven). */
  pendingTabs?: TabKey[];

  relationships?: EntityRelationshipDescriptor<T>[];   // §9
};

export type EntityTabDescriptor<T = RaRecord> = {
  key: TabKey;                    // closed union — §3
  /** OPTIONAL — and omitting it is the NORMAL case, not the exception. Absent, the label
   *  resolves through the i18n catalog with TAB_LABELS[key] as the untranslated fallback
   *  (§3 rule 2). Set it ONLY for a genuine per-entity deviation from the canonical
   *  vocabulary, and carry a one-line comment saying why THAT entity deviates. */
  label?: string;
  render: () => ReactNode;        // LAZY. See rule 4 below.
  visibleTo?: MemberRole[];       // absent = visible to every role
};
```

Rules:
1. `ComponentType<{record}>` for every region. A `(record) => ReactNode` **structurally cannot
   call a hook**, and the only real stat band in the app is
   `useGetOne<ShadchanStats>("shadchan_stats", { id })` (`shadchanim/ShadchanShow.tsx:40-43`,
   view `03_views.sql:202`). `singles_summary` carries its counts inline, so a `singles` fixture
   test passes while 5.9 dies — do not use `singles` as the proof.
2. `actions` is rendered by `EntityShow` **inside** the identity-header region, after
   `identityHeader`. It is never a region of its own on `Entity360`. This is where 5.1's
   `ShidduchStateControl` and 9.2's Single-360 action live.
3. `MemberRole` is imported from `src/components/atomic-crm/types.ts:109-110`. Re-declaring it —
   as `Role`, as a local union, anywhere — is a review-blocking defect. `InvitableRole`
   (`types.ts:117`) already derives from it.
4. `render` is **lazy** (`() => ReactNode`, no argument). The tab's subtree is constructed only
   when that tab is the active one. The record is reached inside `render` via
   `useRecordContext()` — `EntityShow` mounts inside `ShowBase` (§5), so a `RecordContext`
   always exists.
5. Region components are `ComponentType`, so a descriptor module **may live in and import from
   its entity folder** (`singles/entityDescriptor.ts` may import `singles/SingleFactsCard.tsx`).
   The `?raw` boundary test is scoped to `entity360/EntityShow.tsx` alone (§4 rule 5).
6. There is no `stats?: (record) => {label,value}[]` field. It is deleted. `statBand` replaces it.
7. There is no `minVisibility`. The field is `visibleTo`, an **allow-list**, not a threshold.
   Absent means visible to every role.
8. **`EntityTabDescriptor.label` is optional, and `EntityShow` passes it as `useTabLabel`'s
   `override` only when the descriptor explicitly set one** (owner ruling, §3 rule 2).
   `EntityShow` must never substitute `TAB_LABELS[key]` itself and pass that as an override —
   doing so makes every tab an override, the translation catalog is never consulted, and the
   i18n path is dead while its round-trip test still passes. `EntityShow` passes
   `tab.label` (possibly `undefined`) straight through; it never calls `translate` for a tab
   label and never applies a `?? TAB_LABELS[...]` default. A descriptor that *does* set
   `label` carries a one-line comment saying why that entity deviates from the canonical
   vocabulary; a `label` without such a comment is a review-blocking defect.

---

## 3. `TabKey` — a closed union (Story 3-13, lands before 3.3a)

```ts
// src/components/atomic-crm/entity360/tabKeys.ts
export const TAB_KEYS = [
  "overview", "activity", "notes", "tasks", "files", "related",
  "resume", "photo", "medical", "diligence", "external-links",
  "shidduchim", "conversations", "discussions", "assistant",
] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_LABELS: Record<TabKey, string> = {
  overview: "Overview",
  activity: "Activity",
  notes: "Notes",
  tasks: "Tasks",
  files: "Files",
  related: "Related",
  resume: "Resume",
  photo: "Photo",
  medical: "Medical",
  diligence: "Diligence",
  "external-links": "External links",
  shidduchim: "Shidduchim",
  conversations: "Conversations",
  discussions: "Discussions",
  assistant: "Assistant",
};
```

Rulings that close the drift already present in the story set:

| Drifting names | Ruling |
|---|---|
| `5-8:107` `shidduchim` (single) · `5-9:62` `suggestions` (shadchan) · `5-10:69` `linked-shidduchim` (reference) | **One key: `shidduchim`. One label: "Shidduchim".** All three are "the shidduchim related to this record"; the query differs, the vocabulary does not. `suggestions` is additionally an AD-23 violation as a user-facing word. 5-8 / 5-9 / 5-10 are amended to this key. |
| `7-1:271-278` `discussions` (shidduch threads) · `8-5:36,86-87` "Conversations" (connection threads) | **One key: `discussions`, label "Discussions"**, for every Epic 7 `threads/ThreadPanel.tsx` surface. 8-5's tab key is `discussions`. |
| `conversations` (reference) | **Kept and distinct.** It is the reference **call log** (`RepeatRecognitionPanel` + `ReferenceCallLog`), not a thread panel. UX-DR5 names it. The two keys are not interchangeable; the distinction is call log vs. Epic 7 thread. |
| 9-2 "Listing" | **Not a tab.** 9-2:151-153 already rules it out; no key is reserved. |

Rules:
1. `EntityTabDescriptor["key"]` is `TabKey`. Free strings are a review-blocking defect.
2. **Label resolution is exactly, and only:**

   ```ts
   // entity360/useTabLabel.ts
   export function useTabLabel(key: TabKey, override?: string): string;
   //   override ?? translate("crm.entity360.tab." + key, { _: TAB_LABELS[key] })
   ```

   i18n first, the canonical catalog as the **untranslated fallback** — never the other way
   round. The key namespace is **`crm.entity360.tab.<key>`** (the whole CRM catalog nests
   under a single `crm` root, `providers/commons/englishCrmMessages.ts:104`, so a bare
   `entity360.tab.<key>` can never resolve; earlier revisions of this contract said the bare
   form and were wrong). `_:` fallback per AD-18 / the spine i18n convention — same pattern as
   4-1's `label` use.

   An entity may override the string, never the key — but `EntityTabDescriptor.label` is
   **optional** and normally absent (§2 rule 8). `override` is reserved for a genuine
   per-entity deviation from the canonical vocabulary and must carry a one-line comment
   explaining that entity's deviation. Nothing between the descriptor and `useTabLabel` may
   synthesise an override out of `TAB_LABELS`.

   **Round-trip test (3-10 AC 3) must be able to fail if resolution bypasses the catalog.**
   Three assertions, all falsifiable:
   (a) for **every** key in `TAB_KEYS`, `translate("crm.entity360.tab." + key)` under the real
   English catalog equals `TAB_LABELS[key]` — this is what fails when the union grows and the
   catalog does not, drift the `_:` fallback would otherwise hide (`polyglotI18nProvider` is
   configured `{ allowMissing: true }`, `i18nProvider.ts:48`);
   (b) a tab descriptor with **no** `label` renders the canonical label; and
   (c) with a translation registered for `crm.entity360.tab.<key>` that differs from
   `TAB_LABELS[key]`, **the registered translation wins** over the canonical label for that
   same descriptor. (c) is the assertion that goes red if the catalog is bypassed; a test suite
   that only proves an explicit override is returned proves nothing about i18n.
3. **Adding a tab key is a one-line edit to `TAB_KEYS` plus one to `TAB_LABELS`, made in the same
   diff as the story that needs it.** The union being closed is the point; widening it is cheap
   and reviewable. A story that needs a key not listed here adds it — it does not fall back to a
   string.
4. `related` is the generic key for `RelatedRecordsTab` (§9) where no entity-specific key applies.
5. Per-entity tab sets, canonical (UX-DR5 + sanctioned exceptions), in order:
   - **Shidduch** — `overview, resume, photo, medical, files, diligence, external-links, notes, tasks, activity` (+ `discussions` appended by 7-1)
   - **Single** — `overview, resume, photo, files, shidduchim, notes, tasks, activity`
   - **Shadchan** — `overview, shidduchim, notes, tasks, activity`
   - **Reference** — `overview, conversations, shidduchim, notes, tasks, activity, assistant`
   - **Connection** (Epic 8) — `overview, discussions`

   **Conformance rule — consistency is enforced, completeness is declared.** The validator
   (§12, story 3-15) transcribes this table as `CANONICAL_TAB_SETS` and asserts, for **every**
   registered descriptor:

   a. every key in `tabs` **and** in `pendingTabs` is a member of `TAB_KEYS`;
   b. no key appears twice — within `tabs`, within `pendingTabs`, or once in each;
   c. the keys of `tabs` are a **subsequence** of this table's row for that entity (canonical
      *relative* order), and `pendingTabs` likewise;
   d. `keys(tabs) ∪ pendingTabs` **equals** this table's row, compared as **sets**, in both
      directions.

   (a)–(c) are the whole of AD-24's actual invariant — entities do not **diverge** — and have
   no escape hatch of any kind. (d) is completeness, and it is satisfied by a **declaration**
   (`pendingTabs`, §2), not by requiring every tab on day one: an entity may ship a partial
   `tabs` array, and 5-1 deliberately does (`overview, diligence, notes, tasks, activity`,
   with `resume`/`photo`/`medical`/`files`/`external-links` pending and placeholder tabs
   explicitly forbidden). A story that simply forgets a tab is still caught by (d), because
   the forgotten key appears in neither array. A descriptor whose `name` has **no** row here is
   itself a violation — the table is widened by the story that needs the key (rule 3), in the
   same diff, and 7-1 / 8-5 must add their row or key **and** the descriptor entry together or
   (d) fails.

   Because `pendingTabs` is re-asserted against this table on every run, it cannot outlive its
   reason: there is **no stub-exemption list and no staleness machinery** for tabs. A story
   that builds a tab moves its key from `pendingTabs` into `tabs` — one line, and omitting it
   fails (d). Epic 5's closing story flips 3-15's pending-tab ledger from informational to
   failing, so the epic cannot be declared done with tabs still pending.

---

## 4. Registry — three functions (Story 3.3a)

```ts
// src/components/atomic-crm/entity360/registry.ts
export function registerEntityDescriptor<T extends RaRecord>(
  descriptor: EntityDescriptor<T>,
  opts?: { replace?: boolean },
): void;
export function getEntityDescriptor(name: string): EntityDescriptor | undefined;  // callers MUST guard
export function requireEntityDescriptor(name: string): EntityDescriptor;          // throws, fail-fast
```

Rules:
1. Backing store is a private `Map` keyed by `name`. The `Map` is never exported.
2. Duplicate `name` **without** `{ replace: true }` throws. **With** it, replaces. `replace` is
   the extend API — it is what `4-1:162`, `5-1:93`, `5-8:105`, `5-9:95`, `5-10:106` all mean by
   "extend" / "fill in". There is no `updateEntityDescriptor`, no partial merge: the replacing
   module supplies the whole descriptor.
3. `getEntityDescriptor` returns `| undefined` and is for code that must degrade
   (`RecordLink`, §8). `requireEntityDescriptor` throws `Error("No entity descriptor registered
   for resource \"x\"")` and is for code where absence is a bug (`EntityShow`, path builders).
   `.claude/rules/coding-style.md#Error-handling` — never dereference the guarded form.
   `root/routeManifest.ts:93-99` declares **7** resources; only 4 get descriptors in Epic 3, so
   `EntityList` over `tasks`/`inbox_items`/`members` must use the guarded form.
4. **Home:** `src/components/atomic-crm/<entity>/entityDescriptor.ts`. The module exports the
   descriptor object **and** calls `registerEntityDescriptor` at module scope.
   `<entity>/index.ts` adds `import "./entityDescriptor";` as its first line.
   `root/routeManifest.ts:6-18` already imports every resource index module at module scope and
   `CRM.tsx` maps over `RESOURCES` at boot, so **registration is complete before first render** —
   no lazy import, no registration inside a component, no `useEffect`.
5. 3.9's four stubs are written as **files Epic 5 will replace**
   (`singles/entityDescriptor.ts`, `shadchanim/…`, `references/…`, `shidduchim/…`), not as four
   literals in one shared file that four Epic 5 stories concurrently hand-edit. Each stub
   declares `pendingTabs: <its full canonical set from §3 rule 5>` alongside its empty `tabs`;
   that is what makes a stub legal under §3 rule 5(d) and it replaces any notion of a
   stub-exemption list.
6. Registry order is irrelevant and must stay irrelevant: no descriptor may read another at
   module scope.

### `EntityShow` (Story 3.3b)

```ts
// src/components/atomic-crm/entity360/EntityShow.tsx
export function EntityShow(): ReactElement;   // no props
```
- Reads `useResourceContext()` and `useRecordContext()`. **No `{resource, record}` props, and no
  "or" between the two mechanisms** — the repo pattern (`singles/SingleShow.tsx`,
  `shadchanim/ShadchanShow.tsx`) is context, and an "or" contract is untestable.
- Looks the descriptor up with `requireEntityDescriptor`.
- Renders `Entity360` with exactly: `breadcrumb` (reserved, currently undefined),
  `identityHeader` = `<IdentityHeader record/>` else the `avatar`/`title`/`meta` default
  composition, immediately followed by `<Actions record/>`; `statBand` = `<StatBand record/>`;
  `alertSlot` = `<AlertSlot record/>`; `tabBar`+`children` = `<Entity360Tabs/>` (§6);
  `rightRail` = `<RightRail record/>`. **Nothing else. No entity name appears in this file.**
- Missing optional fields degrade: a descriptor with only `name`, `buildRecordPath` and `label`
  renders without stat band, tab bar or rail, and does not throw.
- Boundary test (`?raw`) is scoped to `EntityShow.tsx` **alone** and asserts **no import from any
  sibling directory of `entity360/`** — not a four-name alternation (`connections/` arrives in
  8-5) — **and** no entity-name string literal. Prove it red against a deliberately broken
  fixture before shipping it green.

### Path builders (Story 3.2, derived from the descriptor)

```ts
// src/components/atomic-crm/entity360/entityPaths.ts
export function buildListPath(name: string): string;                        // `/${name}`
export function buildNewPath(name: string): string;                         // `/${name}/new`
export function buildRecordPath(name: string, id: Identifier): string;      // descriptor.buildRecordPath(id)
export function buildEditPath(name: string, id: Identifier): string;        // `${record}/edit`
export function buildTabPath(name: string, id: Identifier, tab: TabKey): string; // `${record}/${tab}`
```
All five go through `requireEntityDescriptor`, so Epic 5's one-line `buildRecordPath` flip
propagates to edit links, tab links and deep links at once. Nothing in the app builds a
`/{entity}/{id}…` string by template literal.

---

## 5. Routes (Story 3.2 declares the shape; **Story 3.12 adopts it app-wide**)

**Scope boundary — binding, and not re-mergeable.** **3.2** owns the route *table*
(`buildEntityRoutes`, which declares the `new` segment) and the *path builders*
(`entityPaths.ts`, §4). **3.12** owns *everything that must now point at them*: the
`/create` → `/new` rename of the 14 live sites plus the `/create` compatibility redirect, the
`useCreatePath` / `CreateButton` / `EditButton` / `ShowButton` overrides, the four
`redirect="show"` props, `RECORD_FLAG_EXEMPTIONS` + explicit `hasShow`/`hasEdit`, and the
`check-route-convention` CI guard. Rules 2–4 below are therefore **3.12's**, not 3.2's. 3.2
ships with the app still on `/create` and that is correct, not an incomplete story. A builder
who folds 3.12 back into 3.2 has merged a framework story with a 14-file app-wide sweep — do
not do it.


```ts
// src/components/atomic-crm/entity360/buildEntityRoutes.tsx
export function buildEntityRoutes(config: {
  List: ComponentType;
  New?: ComponentType;
  Edit?: ComponentType;
  Show: ComponentType;     // normally EntityShow
}): ReactElement;
```

Nested `<Routes>` produced, in this order:

| Path | Renders |
|---|---|
| `index` | `<List/>` |
| `new` | `<New/>` |
| `:id/edit` | `<Edit/>` |
| `:id` | `<ShowBase><Show/></ShowBase>` |
| `:id/:tab` | `<ShowBase><Show/></ShowBase>` |

Rules:
1. **`ShowBase` (from `ra-core`, as used by `src/components/admin/show.tsx`) wraps both record
   routes.** Nothing else under `buildEntityRoutes` fetches. Without this the first migrated 360
   renders an empty shell and every Epic 5 story improvises its own fetch. `ShowBase` supplies
   `RecordContext`, pending and error state.
2. **[3.12]** **The route segment is `new`, never `create`** (UX-DR2 / AD-24). 3.2's route table
   declares it; the app is `/create` in 14 places today (`dashboard/Dashboard.tsx:36,56`,
   `layout/MobileNavigation.tsx:172`, `singles/SingleList.tsx:46`,
   `shidduchim/ShidduchimList.tsx:78` `matchPath("/shidduchim/create")`, …) and **3.12** renames
   all of them — each to `buildNewPath("<entity>")`, never to a hand-written `"/x/new"` — and
   adds the `/{entity}/create` → `/{entity}/new` permanent redirect that keeps the query string
   (`references/ReferenceCreate.tsx:89` and `shidduchim/ShidduchCreate.tsx:54-56` read it).
3. **[3.12]** **`useCreatePath` is broken for `edit` and `create`, not only `show`**
   (`node_modules/ra-core/dist/routing/useCreatePath.js:46,48,56`): `create` →
   `/{resource}/create`; `edit` → `/{resource}/{id}`, **byte-identical to AD-24's show URL**.
   **3.12** overrides `admin/create-button.tsx`, `admin/edit-button.tsx` and
   `admin/show-button.tsx` to build `to` from `buildNewPath` / `buildEditPath` /
   `buildRecordPath` for any resource that has a descriptor, falling back to `useCreatePath` for
   those that do not, and switches the four `redirect="show"` props onto a `RedirectToFunction`
   built from `buildRecordPath`. Assert: Edit lands on `/{entity}/{id}/edit`, Create lands on
   `/{entity}/new`, and the no-descriptor fallback is asserted too.
4. **[3.12]** **A migrated entity registers `list` only on `<Resource>` AND passes explicit
   `hasShow`/`hasEdit`** (`ra-core/dist/core/Resource.js:33-34` reads `!!show || !!hasShow`).
   Without them `useGetPathForRecord` resolves nothing and **every `<DataTable>` row stops being
   clickable** (`src/components/admin/data-table.tsx:233`). Assert with a row-click test before a
   migration is called done. **3.12** adds `RECORD_FLAG_EXEMPTIONS` to `root/routeManifest.ts`
   and the manifest rule that enforces this. (`shidduchim` is already list-only and unaffected —
   it is a Kanban board and never goes through `<DataTable>` — so it is one of the three seeded
   exemptions, with its reason written down.)
5. **Unknown tab** → `replace`-navigate to the **first visible** tab (§6). Re-evaluated on
   **every location change**, not only on mount.
6. **Role pending** (`useViewerRole()` returns `undefined`) → render a pending state and **do not
   navigate**. Navigating here rewrites a deep link before the role resolves. Assert:
   deep-linking to a permitted restricted tab leaves `location.pathname` unchanged and adds no
   history entry.
7. **Record not found / not in the active context** → an explicit handled state
   (`<RecordUnavailable/>` with a link back to the list), never a blank screen and never an
   automatic navigate. Under AD-19 a record from a non-active context returns an empty result
   set, not an error (`ContextSwitcher.tsx:98-101` invalidates and sends the user to `/`).
8. **Composition order:** Epic 8 Story 8.1 wraps `EntityRoutes` at the **resource** level with
   `<RequireContextKind>` (`8-1:52-55`). The guard is never nested per-route inside
   `buildEntityRoutes`.
9. `Resource` wraps the `list` element in
   `<RestoreScrollPosition storeKey={`${name}.list.scrollPosition`}>`; since `EntityRoutes` *is*
   the list element, show/tab renders inherit the list's saved scroll offset. Suppress it for the
   non-index routes.

---

## 6. Tabs & visibility (Stories 3.2 / 3.4)

```ts
// entity360/Entity360Tabs.tsx
export function Entity360Tabs(props: {
  // `label` is OPTIONAL and is the caller's *override*, not a resolved string: `Entity360Tabs`
  // renders `useTabLabel(key, label)` (§3 rule 2). `EntityShow` forwards `tab.label` verbatim,
  // including `undefined` — it must not fill it in from TAB_LABELS (§2 rule 8).
  tabs: { key: TabKey; label?: string; render: () => ReactNode }[];
}): ReactElement;

// entity360/visibility.ts
export function hasVisibility(
  visibleTo: MemberRole[] | undefined,
  role: MemberRole | undefined,
): boolean;   // undefined visibleTo -> true; undefined role -> false (fails closed)

// entity360/useViewerRole.ts
export function useViewerRole(): { role: MemberRole | undefined; isPending: boolean };
```

Rules:
1. **`useViewerRole` is built on `my_contexts()`**, not on `members.administrator`:
   `useMyContexts().data?.find(c => c.is_active)?.role` (`root/useMyContexts.ts:12-18`,
   `02_functions.sql:341-350`, row type `MyContext` at `types.ts:165-171`).
   `members.administrator` is a **global per-login** column (`01_tables.sql:14-23`) — using it
   gives a login the same role in its household and its shadchanus context and makes
   `self_manager` and `single` unreachable, silently dead-coding `5-5:86`, `6-1:141`, `6-4:169`.
   `getIdentity` does not expose it (`providers/supabase/authProvider.ts:9-22`) and no story
   authorises editing it. Assert: after `ContextSwitcher` switches contexts, `useViewerRole()`
   returns a **different** value for a login holding two memberships with different roles.
2. **Filtering happens before the array reaches `Entity360Tabs`.** A denied tab's `render` is
   never called and its label never enters the DOM. `Entity360Tabs` does no permission work.
3. `undefined` role fails closed **without navigating** (§5 rule 6).
4. Tab navigation uses **absolute paths from `buildTabPath`**, resolved from
   `useResourceContext()` + `useRecordContext()` inside `Entity360Tabs`. Relative navigation is
   forbidden: `useParams()` inside the nested `<Routes>` yields `id` and `tab` but never the
   entity segment, and the two entry states (`:id` → append, `:id/:tab` → replace) diverge.
5. Tab clicks `push`. The unknown-tab fallback `replace`s.
6. 3.4 also owns `src/components/atomic-crm/providers/commons/canAccess.ts` — still the binary
   `admin`/`user` check at `:16-25`, with 3.4 and `2-7:261-264` currently pointing at each other.
   It is retired or rewritten onto `MemberRole` here.

---

## 7. `RecordLink` (Story 3.9)

```tsx
// entity360/RecordLink.tsx
export function RecordLink(props: {
  resource: string;
  id: Identifier;
  children: ReactNode;
  className?: string;
  /** The one escape hatch, and the only one. Two swept sites (`singles/SingleCard.tsx:60-61`,
   *  `references/ReferenceList.tsx:70`) set `style={{ animationDelay }}` on the anchor next to
   *  the `.ql-enter` class; `.ql-enter` is `animation: ql-rise … both` (`src/index.css:496-498`)
   *  and `animation-fill-mode: both` keeps the final keyframe's `transform` applied, so moving
   *  the pair onto the inner `<Card>` would override its `hover:-translate-y-0.5` /
   *  `active:scale-[0.98]`. Same concern `className` already covers. Forwarded verbatim on both
   *  the `<a>` and the degraded `<span>` (rule 2). */
  style?: CSSProperties;
}): ReactElement;
```

Rules:
0. **Exactly these five props.** No `onClick`, no `ref` forwarding, no `{...rest}` spread — a
   caller that needs drag props, a ref or a click guard puts them on its own wrapper element
   (§7 rule 4). `style` is the single sanctioned addition to the original four and is not a
   precedent for a sixth; `@hello-pangea/dnd` sets its own inline `transform` on the node it
   owns, and that node must not also be the anchor.
1. Path = `getEntityDescriptor(resource)?.buildRecordPath(id)`.
2. **Unregistered resource → render an inert `<span>{children}</span>` plus one
   `console.error`. It MUST NOT throw.** 3.5 links from `interactions.metadata`, which is
   free-form `jsonb` that clients may write (`06_grants.sql:615-616` grants
   `update (body, metadata)`); a throw at render blanks the entire Activity tab. Assert: an
   interaction row with `linkedResource: "nope"` still renders the rest of the tab.
3. Board cards preserve `{ _scrollToTop: false }` behaviour (`shidduchim/ShidduchCard.tsx:89-100`);
   a bare `<Link>` drops it and board clicks start jumping to top.
4. dnd prop spreads stay **before** `onClick` (`ShidduchCard.tsx:101-108`) —
   `@hello-pangea/dnd`'s `dragHandleProps` carries its own handlers.
5. Every record mention anywhere routes through this component (UX-DR6): board card, list row,
   timeline entry, rail panel, search result, reminder card. 3.9's 12-site sweep inventory is
   accurate — do not "correct" it.
6. 3.9 also deletes `reminders/reminderEntity.ts:29`'s `shidduch: "Suggestion"` and `:60`'s
   `"Suggestion"` fallback (live AD-23 violations, user-facing via `ReminderCard.tsx:58-64`),
   and replaces `targetEntityPath` (`:34-47`, whose `/show` paths and "shadchanim has no /show"
   comment are both wrong) with `buildRecordPath`.

---

## 8. Universal tab props and the target-type vocabulary (Stories 3.5–3.8)

```ts
// src/components/atomic-crm/types.ts  — the ONE source of truth
export const ENTITY_TARGET_TYPES = ["shidduch", "single", "shadchan", "reference"] as const;
export type EntityTargetType = (typeof ENTITY_TARGET_TYPES)[number];
export type TaskTargetType = EntityTargetType;   // the 3-value union at types.ts:71 is widened, not duplicated

// entity360/tabs/types.ts
export type UniversalTabProps = { targetType: EntityTargetType; targetId: Identifier };
```

`ActivityTab`, `NotesTab`, `FilesTab`, `TasksTab` each take **exactly** `UniversalTabProps` —
no extra props, no per-entity variants.

Rules:
1. Three DB check constraints must end up with **the same four values**:
   `tasks_target_type_check` (`01_tables.sql:45-47`, today
   `('shadchan','shidduch','reference')`), `interactions_target_type_check` (`:458-459`, today
   `('reference','shidduch')`), and the new `entity_files` check. **`single` is legal in neither
   table today, and `shadchan` is illegal in `interactions`** — state that as present fact, and
   the widening as this epic's future work.
2. A vitest guard reads `supabase/schemas/01_tables.sql` via `?raw` and asserts each check's
   value set is a subset of `ENTITY_TARGET_TYPES`, plus an explicit
   `PENDING_DB_WIDENINGS` constant listing the constraints not yet at parity. 3.5, 3.7 and 3.8
   each shrink that list; story 3-15 asserts it is empty. (The only in-repo `?raw` precedent is
   `references/entitlementGate.guard.test.ts:16-20`'s `import.meta.glob`; a bare
   `import x from "./y?raw"` needs a `*?raw` module declaration to typecheck under `strict`.)
3. **Every new target type gets a purge trigger in the story that adds it.**
   `purge_polymorphic_dependents()` (`02_functions.sql:1799-1817`) is wired only at
   `04_triggers.sql:109-111` (`references`) and `:118-120` (`shidduchim`), and
   `interactions.target_id` carries no FK by design. **Story 3.5 adds the triggers on
   `public.singles` and `public.shadchanim`. Story 3.7 extends the function to cover
   `entity_files` and to delete the storage objects.** Assert: deleting a single or a shadchan
   leaves zero `tasks` / `interactions` / `entity_files` rows for it.
4. `'connection'` is **Epic 8's** value to add (8.2/8.5), not Epic 3's.
5. `entity_files` is a **new** table and is **not** attached to `enforce_household_scope()` —
   it must work in a shadchanus context from day one (Epic 8.5). Say so in 3.7 explicitly; this
   closes §3-J for files.
6. Migration hygiene: `02_functions.sql` must be in exact `pg_dump` form
   (`CREATE OR REPLACE FUNCTION "public"."name"() … LANGUAGE "plpgsql"`, e.g. `:201-203`) or
   `supabase db diff` produces a phantom diff. Every table grant is paired with
   `revoke all on sequence public.<t>_id_seq from anon;` (`06_grants.sql`, 56 such lines).

---

## 9. `relationships` — decided: **kept, in the `getFilter` form**

`{resource, foreignKey}` cannot express `reference → reference_links → shidduchim`, the one
many-to-many the domain actually has and which UX-DR9 requires be visible. The field is kept and
made expressive, and Epic 3 ships the renderer — otherwise three stories hand-roll the same list
(`5-8:113`, `5-10:106-114`, `8-5:24`).

```ts
// src/components/atomic-crm/entity360/relationshipDescriptor.ts
// Its own module, NOT entityDescriptor.ts: it is keyed by `TabKey` and consumed by
// `RelatedRecordsTab`, both of which land in the tab-vocabulary story (§12 step 0) — before
// 3.3a exists. 3.3a's `EntityDescriptor.relationships` imports it from here and re-exports it,
// so `entity360/entityDescriptor.ts` stays the one import site consumers need to know about.
export type EntityRelationshipDescriptor<T = RaRecord> = {
  key: TabKey;                                   // e.g. "shidduchim"
  label?: string;                                // override only; resolves per §3 rule 2
  /** resource to query — MAY be a summary view that already resolves a join table */
  resource: string;
  getFilter: (record: T) => Record<string, unknown>;
  sort?: { field: string; order: "ASC" | "DESC" };
  perPage?: number;
  /** resource the row's RecordLink targets; defaults to `resource` */
  linkResource?: string;
  /** id the RecordLink navigates to; defaults to (row) => row.id */
  linkId?: (row: any) => Identifier;
  /** row label; defaults to the resource's recordRepresentation */
  linkLabel?: (row: any) => string;
  emptyLabel?: string;
};
```

```ts
// entity360/tabs/RelatedRecordsTab.tsx
export function RelatedRecordsTab(props: { relationship: EntityRelationshipDescriptor }): ReactElement;
```

- `EntityShow` turns each `relationships` entry into a tab at the position its `key` occupies in
  the entity's declared tab order, rendering `RelatedRecordsTab`. A descriptor may still declare
  an explicit `tabs` entry with the same key to override it.
- Worked example (reference → shidduchim):
  `{ key: "shidduchim", resource: "reference_links_summary",
     getFilter: (r) => ({ reference_id: r.id }), linkResource: "shidduchim",
     linkId: (row) => row.shidduchim_id }`.
  The column is **`shidduchim_id`** (`supabase/schemas/03_views.sql:139`, from
  `reference_links.shidduchim_id`). There is no `shidduch_id` on that view — `:150-153` has
  `shidduch_name_en` / `shidduch_name_he` / `shidduch_pipeline_state`, which is where the
  singular crept into an earlier revision of this example. A builder copying the singular gets
  `undefined` ids and every row in the Reference-360 shidduchim tab links nowhere.
- Worked example (single → shidduchim): `{ key: "shidduchim", resource: "shidduchim",
  getFilter: (r) => ({ single_id: r.id }) }`.
- Every row renders a `RecordLink`. Empty / loading / error states are the tab's, not the
  caller's (UX-DR11).

---

## 10. Ownership assignments (previously unowned)

| Artefact | Owner | Note |
|---|---|---|
| `types.ts` — `ENTITY_TARGET_TYPES` / `EntityTargetType`, widening `TaskTargetType` (`:71`) | **3.9** | 3.9 owns `reminders/` in the same diff (`reminderEntity.ts:21,28` `Record<TaskTargetType,string>` maps, `useReminders.ts:42-45` `ALL_TARGET_TYPES`, `:69-97`'s **three hardcoded `useGetMany` calls + three-row tuple** — a fourth type needs a fourth hook, not a map entry). Widening the TS union while the DB checks still hold 3 values is deliberate and safe: nothing writes a single-targeted task until 3.8. |
| `types.ts` — `Interaction.target_type` (`:477`), `Interaction.deleted_at` | **3.5** | Same story as the DB widening + soft-delete column. Without it `npm run typecheck` fails on the first fixture. |
| Purge triggers on `public.singles` and `public.shadchanim` | **3.5** | §8 rule 3. |
| `entity_files` purge + storage-object cleanup | **3.7** | §8 rule 3. |
| Stat data loading | **the entity's descriptor module**, never `EntityShow` | §2 rule 1. `EntityShow` fetches nothing beyond `ShowBase`'s record. |
| `providers/commons/canAccess.ts` | **3.4** | §6 rule 6. |
| Record fetching / `RecordContext` | **3.2** | §5 rule 1. |
| Route **table** (`buildEntityRoutes`, incl. the `new` segment) + **path builders** (`entityPaths.ts`) | **3.2** | §4 "Path builders", §5 rules 1 and 5–9. 3.2 declares the shape and adopts nothing. |
| **All adoption** of that shape: the `/create`→`/new` rename (14 live sites) + the `/create` compatibility redirect; the `useCreatePath`/`CreateButton`/`EditButton`/`ShowButton` overrides; the four `redirect="show"` props; `RECORD_FLAG_EXEMPTIONS` + explicit `hasShow`/`hasEdit`; the `check-route-convention` CI guard | **3.12** | §5 rules 2–4 and the scope boundary at the head of §5. **Not re-mergeable with 3.2.** |
| `TabKey` union + `TAB_LABELS` + `useTabLabel` + `relationshipDescriptor.ts` + the `overview` / `related` shared components | **3-13** (filed as `3-10-tab-vocabulary.md`) | §3, §9. See the story-number note at the head of §12. |
| The `enforce_household_scope` lift for `tasks` + `interactions` | **3-14** | §11 Ruling 1. |
| AD-24 conformance validator | **3-15** (filed as `3-11-ad24-conformance-validator.md`) | §12. |
| UX-DR3 residue — `shidduchim/ShidduchCreate.tsx` becomes the page at `/shidduchim/new`; `tasks/TaskEdit.tsx` is an exemption with a written reopening trigger; plus the dialog-surface guard (`ShidduchShow.tsx:35` is killed by 5.1) | **3.13** (`3-13-records-at-urls-not-modals.md`) | Split out of 3-15's provisional "or explicitly deferred" wording so 3-15 stays a pure validator and these two rulings get a real owner. |

---

## 11. The two owner rulings — as contract terms

### Ruling 1 — `tasks` and `interactions` leave the household-only scope (Story **3-14**)

`enforce_household_scope()` (`02_functions.sql:387-402`) raises unless
`accounts.kind = 'household'`, and is attached to 13 tables at `04_triggers.sql:159-209`,
including `interactions` (`:195-197`) and `tasks` (`:207-209`). Combined with
`set_tasks_account_id` / `set_interactions_account_id` assigning `current_context_id()`, **every
task and interaction insert by a shadchan in their own context fails with a raw Postgres
exception** — while Epic 8.5 ("the shadchan's own CRM") is built entirely on them. The owner
lifted the restriction. Terms:

1. **Do not modify `enforce_household_scope()`. Do not rename any trigger.** The comment at
   `04_triggers.sql:147-158` warns that renaming is "a migration-time total insert outage, not a
   refactor" *because* Postgres fires same-event BEFORE triggers in alphabetical name order and
   the `validate_*` names are chosen to sort after every `set_*`. The migration is therefore
   exactly two statements, in one transaction:
   `drop trigger if exists validate_interactions_household_scope on public.interactions;`
   `drop trigger if exists validate_tasks_household_scope on public.tasks;`
   DDL is transactional; there is no window in which the check is half-applied. The other 11
   tables are untouched.
2. Update the two comments that count the set (`04_triggers.sql:147-158` "13 household-only
   domain tables" → 11, and `enforce_household_scope()`'s own comment) in the same migration.
3. `db`-project tests, all four required: insert into `tasks` under a **shadchanus** context
   succeeds; insert into `interactions` under a shadchanus context succeeds; insert into
   `singles` under a shadchanus context still **raises**; a member of neither account still reads
   zero rows from both tables (RLS unchanged — scoping stays `account_id = current_context_id()`).
4. Negative-test shape is **one login with memberships in accounts A and B, active in A** — not
   two disjoint users, which passes without ever exercising `current_context_id()`.
5. A shadchan-targeted `interactions` row is `scope = 'account'`, `reference_link_id = null`;
   `interactions_scope_link_check` is untouched.
6. **Rehearsed locally against a seeded database (`npx supabase db reset --local` + seed +
   `npm run test:unit:db`) before it reaches production.**
7. **3-14 is a blocking dependency of 3.5, 3.6 and 3.8** and builds before all three.
8. Remember the D-Bus workaround: prefix every `npx supabase` call with
   `DBUS_SESSION_BUS_ADDRESS=/dev/null`.

### Ruling 2 — Tasks: the tab is canonical, the rail is a summary

1. **Every entity's 360 gets a full `tasks` tab** per UX-DR5. `TasksTab` is the **only**
   component in the codebase that mutates tasks from a 360.
2. Where an entity also has a right rail, the rail renders a **separate, read-only** component:

```ts
// entity360/tabs/TasksRailSummary.tsx
export function TasksRailSummary(props: UniversalTabProps & { limit?: number }): ReactElement;
```
   — the next `limit` (default 3) incomplete tasks by due date, plus a link to
   `buildTabPath(resource, id, "tasks")`. **No add, no toggle, no edit, no delete.**
3. **`5-7` AC 3 is wrong as written** ("the rail **is** Story 3.8's
   `entity360/tabs/TasksTab.tsx` with `{ targetType: "shidduch", targetId }`") and is restated:
   the rail renders `TasksRailSummary`; adding and completing happens in the Tasks tab.
   `5-7`'s "reflects immediately, without leaving the page" is satisfied by the tab, not the rail.
4. Guard test: `TasksRailSummary.tsx` source contains no `useCreate`, `useUpdate`, `useDelete`,
   `useMutation` or form import. Prove it red once.
5. `references/ReferenceTasks.tsx` is the behavioural precedent 3.8 generalises; 5.10 deletes it.
   No third task add/toggle implementation is written.

---

## 12. Build order

**Story-number note — read this before using the table.** Epic 3 is **14 stories**. Two of the
labels in this table are *aliases* that predate the current file set, and one of them collides
with a real story number. The mapping is:

| Label used in this contract | The file it means |
|---|---|
| **3-13** at step 0 (`TabKey` / `TAB_LABELS` / `useTabLabel` / `relationshipDescriptor.ts` / `overview` + `related`) | `3-10-tab-vocabulary.md` |
| **3-15** at step 12 (AD-24 conformance validator) | `3-11-ad24-conformance-validator.md` |
| **3.13** at step 4b (records at URLs, not modals) | `3-13-records-at-urls-not-modals.md` — **a different story from step 0's "3-13"** |

The **step numbers are stable and are cited by the story files** (3.2 is "step 4", 3.3b is
"step 5", and so on). The two stories added after this table was first written are therefore
inserted as **4a** and **4b** rather than renumbering. Steps 0–12 keep their original numbers;
the count of rows is no longer the count of stories.

| # | Story | Why here |
|---|---|---|
| 0 | **3-13** (= `3-10-tab-vocabulary.md`) — `TabKey` union, `TAB_LABELS`, `useTabLabel`, `relationshipDescriptor.ts`, the shared `overview` / `related` components; plus the §2 `EntityDescriptor` rewrite and §10 ownership decisions recorded in the story files | The closed union and the rewritten descriptor are **inputs to 3.3a**, and 3.3a is an input to everything. Landing this after 3.3 means widening a shipped public type mid-Epic-5. (Its `RelatedRecordsTab` half needs 3.9 + 3.3a and lands between steps 3 and 5; the type-and-constants half is what step 0 gates on.) |
| 1 | **3.1** — `Entity360` + `EntityAvatar` | No dependencies, purely presentational. Resolve the AC3/AC4 inline-`backgroundColor` contradiction (§1 rule 6) first. `EntityAvatar` must rewire its four call sites here — do not ship a tested-but-dead module. |
| 2 | **3.3a** — descriptor types + registry only (no `EntityShow`) | The registry has no dependency on the shell and 3.9 needs it immediately. Ships `EntityDescriptor`, `EntityTabDescriptor`, `register/get/require`, and the `<entity>/entityDescriptor.ts` convention. |
| 3 | **3.9** — `RecordLink` + the four stub descriptors + `types.ts` target-type vocabulary + `reminders/` | Needs 3.3a. **Must precede 3.8**: it owns `reminderEntity.ts`'s `Record<TaskTargetType,…>` maps and `useReminders.ts:42-45,69-97`, which 3.8's `single` widening breaks while 3.8's own AC 2 forbids editing `reminders/`. Only this order compiles; 3.8's contradicting ordering note is deleted. Also the only Epic 3 story touching live files, so it lands the AD-23 `"Suggestion"` fix. Re-estimate: ~11 new test files, not "a small leaf component". |
| 4 | **3.2** — `buildEntityRoutes` (route table, incl. the `new` segment), `entityPaths.ts` (path builders), `Entity360Tabs`, `ShowBase` wiring | Needs 3.1's `tabBar`/`children` regions. Declares the AD-24 route shape framework-wide, before any consumer exists. **Adoption is not in this story** — see step 4a and the §5 scope boundary. |
| 4a | **3.12** — route-convention *adoption*: the 14-site `/create`→`/new` rename + the `/create` compatibility redirect, the `CreateButton`/`EditButton`/`ShowButton` overrides, the four `redirect="show"` props, `RECORD_FLAG_EXEMPTIONS` + `hasShow`/`hasEdit`, and the `check-route-convention` CI guard | Needs **3.2** (it adopts `entityPaths.ts`'s builders and re-declares none of them), **3.3a** (every path resolves through the registry — `buildNewPath("singles")` throws without a descriptor) and **3.9** (the four stub descriptors, and the removal of the last app-level `useCreatePath({type:"show"})` at `references/ReferenceList.tsx:68`, without which the guard cannot go green). Must precede **3.3b** and every Epic 5 migration, whose one-line `buildRecordPath` flip is what makes Edit/Show follow automatically. Also blocks **4.1** (its `createTo` props) and **3-15**. |
| 4b | **3.13** (= `3-13-records-at-urls-not-modals.md`) — UX-DR3 residue: `ShidduchCreate` becomes the page at `/shidduchim/new`, the `tasks/TaskEdit.tsx` exemption is recorded with its reopening trigger, and the dialog-wrapped-record-surface guard lands | Needs **3.2** (`buildListPath` for the post-save redirect), **3.9** (the `shidduchim` stub descriptor that makes `buildListPath("shidduchim")` resolve) and **3.12** (its `matchPath("/shidduchim/create")` → `"/shidduchim/new"` rename and the five sibling call sites live in files 3.12 is editing — doing them here would collide). Must precede **3-15**, whose `MODAL_RECORD_SURFACES` table consumes these two rulings instead of re-deriving them. Independent of 3.3b, 3.4 and every universal tab. |
| 5 | **3.3b** — `EntityShow` | Needs 3.1 (shell), 3.2 (`Entity360Tabs`), 3.3a (descriptor), and step 4a's route-convention adoption to be in place. The piece that composes seven regions from a declaration. |
| 6 | **3.4** — permission-aware rendering, `useViewerRole`, `canAccess.ts` | Additive `visibleTo` on 3.3a's types; needs 3.3b to have somewhere to filter and 3.2's fallback path to make the pending-state rule meaningful. |
| 7 | **3-14** — the household-scope lift | **Blocks 3.5, 3.6 and 3.8.** Pure DB, no framework dependency, so it can be rehearsed in parallel with steps 1–6, but it must be applied before any of them. |
| 8 | **3.5** — Activity | First universal tab. Owns the `interactions` widening, `current_member_id()`, the two purge triggers, `Interaction` in `types.ts`. Everything downstream reuses these. Needs 3-14. |
| 9 | **3.6** — Notes | Hard dependency on 3.5's `current_member_id()`, `set_interaction_actor_member_id`, `interactionLabels.ts` and the widened enum. Needs 3-14. Must call `public.is_owning_membership_role(am.role)` (`02_functions.sql:439-444`), never `am.role = 'parent_admin'`, and must resolve note authorship by **`user_id` via a join**, never by `account_members.id` (archive+re-add issues a new id — `01_tables.sql:710`'s partial unique index — permanently stripping an author of their own notes). |
| 10 | **3.8** — Tasks | Needs 3.9 (the `Record` maps) and 3-14 (the trigger). Independent of 3.5/3.6 otherwise. |
| 11 | **3.7** — Files | Heaviest new surface (bucket + table + policies + grants + FakeRest mirror); depends on 3.5's four-value vocabulary and `current_member_id()`. Last, so its premise rewrite has the most information. The `attachments` policies at `supabase/schemas/07_storage.sql:25-44` are the **correct template to copy** with the bucket id swapped — the story currently says the opposite. |
| 12 | **3-15** (= `3-11-ad24-conformance-validator.md`) — AD-24 conformance validator | Needs every primitive to exist before it can assert on them, **plus steps 4a and 4b**: 3.12 supplies the `create-route-on-resource` / `record-flags-missing` violation codes and `RECORD_FLAG_EXEMPTIONS`, and 3.13 supplies the two UX-DR3 rulings its `MODAL_RECORD_SURFACES` table consumes. Modelled on `root/routeManifest.ts:175+`'s `findManifestViolations` + fixture-in-test-file. Asserts: every `RESOURCES` entry has a descriptor or an explicit exemption; every registered descriptor's tab set satisfies §3 rule 5's conformance rule — keys in the union, in canonical relative order, no duplicates, and `tabs ∪ pendingTabs` equal to the canonical set (a partial `tabs` is legal, an undeclared gap is not); no detail/`Show` component outside `entity360/` is route-reachable; no `<Dialog>` wraps a primary record surface; every `buildRecordPath` matches `/{entity}/{id}`; `PENDING_DB_WIDENINGS` is empty. **Must land inside Epic 3, before Epic 5's first migration, or it never lands.** |

**Acyclicity, re-verified over all 14 stories after 4a/4b were inserted.** Read the table as the
total order `0 → 1 → 2 → 3 → 4 → 4a → 4b → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12`. Every declared
dependency edge points strictly forward in it, so the graph has no cycle:

| Story (step) | Depends on (step) |
|---|---|
| 3-13 part A (0) | — |
| 3.1 (1) | — |
| 3.3a (2) | 3-13 part A (0) |
| 3.9 (3) | 3.3a (2) |
| 3-13 part B — `RelatedRecordsTab` (between 3 and 5) | 3.3a (2), 3.9 (3) |
| 3.2 (4) | 3.1 (1) |
| **3.12 (4a)** | 3.3a (2), 3.9 (3), 3.2 (4) |
| **3.13 (4b)** | 3.9 (3), 3.2 (4), 3.12 (4a) |
| 3.3b (5) | 3.1 (1), 3.3a (2), 3-13 part B, 3.2 (4), 3.12 (4a) |
| 3.4 (6) | 3.2 (4), 3.3b (5) |
| 3-14 (7) | — (pure DB; may be rehearsed in parallel with 1–6, but applied before 8/9/10) |
| 3.5 (8) | 3-14 (7) |
| 3.6 (9) | 3-14 (7), 3.5 (8) |
| 3.8 (10) | 3.9 (3), 3-14 (7) |
| 3.7 (11) | 3.5 (8) |
| 3-15 (12) | every row above |

The two constraints most often got wrong are both satisfied and both load-bearing: **3-14 blocks
3.5, 3.6 and 3.8** (7 < 8, 9, 10), and **3.9 precedes 3.8** (3 < 10) because 3.9 owns
`reminders/reminderEntity.ts`'s `Record<TaskTargetType, …>` maps and `useReminders.ts:42-45,69-97`,
which 3.8's `single` widening breaks while 3.8's own AC 2 forbids editing `reminders/`.

Epic 5 does not start until 0–12, including 4a and 4b, are done. 5.1 is the pilot and hits the
missing descriptor fields, the record context and the Create button on its first day.

---

## 13. Test-shape rules that apply to every Epic 3 story

1. Browser-mode vitest (`vitest-browser-react` + `ra-core`'s `TestMemoryRouter`). `render()`
   returns `container`, so `container.textContent` assertions survive.
2. **Every `?raw` source-scanning guard must be shown red against a deliberately broken fixture
   before it is shown green.** Three such guards in the current story set cannot fail at all
   (3.1 AC 3's regex, 3.3 AC 5's four-name alternation, 3.7 AC 4(a)'s grep for a symbol that has
   zero hits repo-wide). A guard that cannot fail is not coverage.
3. Cross-tenant negatives are **one login, two contexts, active in one** — never two disjoint
   users.
4. "Zero rows affected" is not observable through PostgREST (a 0-row UPDATE returns
   404/`PGRST116`, which ra-core throws, indistinguishable from a policy error). Assert it in the
   `db` project via psql.
5. ≥80% coverage on new code (`.claude/rules/testing.md`), AAA, no `waitForTimeout`.
6. Framework-layer user-facing strings go through the `i18nProvider` with an `_:` English
   fallback (AD-18, spine i18n convention) — do not cement hardcoded English label maps inside
   `entity360/`.
