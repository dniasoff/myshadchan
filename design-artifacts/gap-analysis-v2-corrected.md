# MyShadchan — Gap Analysis **v2 (corrected)**

> **This supersedes `gap-analysis-implementation-vs-mockup.md` (v1), which was wrong.**
> v1 inferred each mock screen's identity from filenames and from `screens-plan.md`
> rather than reading the mock's own content. Several screens were mis-identified,
> which made v1 systematically over-rate completeness. Every row below was
> re-derived by stripping the tags off each `is*` screen in `MyShadchan.dc.html`
> and reading what it actually says.

---

## 1. What v1 got wrong (root cause)

| Mock screen | v1 claimed | **Actually is** |
|---|---|---|
| `isCandidates` | "Children list" → `children/ChildList`, **✅ built ~85%** | **"Shidduchim — {child}"** — the shidduchim **list** view, with `Board view / ☰ List / ▦ Cards` toggles + search. **Not built at all.** |
| `isChildinput` | "Add/edit child form" → `children/ChildInputs`, **✅ built ~85%** | A **suggestion detail** for another candidate (Chaim Landau — "Suggested by Mrs. Gold", "Resume & details"). Not a child form. |
| `isReference` | "Reference book" → `references/*`, **✅ built ~90%, most complete lane** | **"← Dovid Berkowitz · 360° view / References — Dovid Berkowitz / Diligence for this suggestion"** — a **per-shidduch diligence workspace**, reached *from* a shidduch. Not a standalone entity. |
| `isTasks` | "Superseded by Reminders" → **I redirected `/tasks` → `/reminders`** | A **real, distinct screen**: "Tasks — shared across the family; each task is tied to a shidduch or shadchan, and assigned to a person." Assignment + family sharing is not what Reminders does. |
| `isDetail` | **🟡 partial ~65%** | A full **page** with 9 tabs + right rail. The app ships a cramped **modal**. Realistically **~20%**. |
| `isSignin` | ✅ built ~85% | **Magic link + passkey** ("We'll email you a link", "Use a passkey instead", "affirm you're 18 or older"). App is **email+password + Google**. Different auth model. |
| `isPrivacy` | "settings ~85%" | A **Parent ↔ Rivky two-way visibility matrix** ("what each side sees", in both directions). App's Settings is a preferences page. |

---

## 2. The three structural gaps you identified

### 2a. Navigation / information architecture is wrong

| Mock nav (8) | App nav (7) | Verdict |
|---|---|---|
| Dashboard | Dashboard | ok |
| Inbox | Inbox | ok |
| Pipeline | Pipeline | ok |
| **Shidduchim** | — | **MISSING** |
| Shadchanim | Shadchanim | ok |
| **Tasks** | — | **REMOVED BY ME** (regression, shipped to prod) |
| Reminders | Reminders | ok |
| Settings | Settings | ok |
| — | **References** | **SHOULD NOT BE TOP-LEVEL** |

### 2b. "Missing shidduchim" — the list view doesn't exist
The mock has **two** views of suggestions: `Pipeline` (the 7-column kanban) **and**
`Shidduchim — {child}` (a searchable list with `☰ List` / `▦ Cards` toggles and a
"Board view" switch back). The app only ever built the kanban. There is no
shidduchim list, no list/card toggle, no search over suggestions, and no
`Shidduchim` nav entry.

### 2c. References are per-shidduch diligence, not a standalone entity
The mock reaches references **only** from a suggestion — the screen header is
literally `← Dovid Berkowitz · 360° view` → `References — Dovid Berkowitz` →
*"Diligence for this suggestion"*, and the detail page carries a
**`References & diligence` tab**. The app instead has a top-level `References`
section with its own list / detail / create / merge — so a reference exists with
no answer to *"about which shidduch?"*.

> **✅ DECIDED (confirmed by Daniel, 2026-07-24):** a reference **can** be used for
> multiple shidduchim — **but the user must be made aware of it.** So:
> - **Keep** the many-to-many data model (`references` + `reference_links`). The
>   *person* stays reusable and dedupable underneath. **No migration needed.**
> - **Remove** the top-level `References` nav section. The *surface* is always
>   per-shidduch diligence, reached from the suggestion's 360° view.
> - **Awareness is mandatory, not optional:** whenever a reference is reused, say
>   so plainly — "you've spoken to them before about N other singles" — at the
>   moment it matters (adding a reference to a shidduch, and opening one).
>
> This is a **presentation/IA change, not a data-model change.**

**Most of the machinery already exists — it is mis-placed, not missing:**

| Piece | Exists? | Where it lives now | Where it belongs |
|---|---|---|---|
| Many-to-many link | ✅ | `reference_links` table | unchanged |
| "Spoken to them about N other singles" | ✅ `RepeatRecognitionPanel` | `ReferenceShow` (standalone page) | the per-shidduch diligence view |
| Match-on-entry ("you already have this person") | ✅ `ReferenceMatchPanel` / `useReferenceMatch` | `ReferenceCreate` (standalone) | adding a reference **to a shidduch** |
| Per-shidduch references section | ✅ `ShidduchReferencesSection` | already inside `ShidduchShow` | keep + enrich |
| Diligence workspace (cross-reference summary, call mode, list/cards) | ❌ | — | new, under the shidduch |
| Top-level `References` nav + list/create/merge routes | ⚠️ exists | nav | **remove from nav** (keep merge as a maintenance path) |

So the References work is mostly **relocation + one new workspace screen** — not a rebuild.

---

## 3. The suggestion detail — the biggest single gap

**Mock (`isDetail`)** is a full page: `← Back to pipeline`, a **locked photo**
("tap to view"), bilingual name, meta line (age · height · location · shul ·
yeshiva), **Set decision** dropdown, **marital status**, **children**, redt date,
a **catch banner** ("First suggested by Mrs. Feldman 3 months ago · possible
prior date (Feb 2026)"), an **AI diligence dossier** (Paid) with
Consensus / Contradiction / Gap + "Open reference workspace →", and tabs:

`Profile · Resume · Photo · Medical · Attachments · References & diligence · External links · Notes · Timeline`

…plus a **right rail**: *Rivky's input* (the child's own note back), *Reminders on
this suggestion*, **Forward resume**, **Share via link**.

**App** ships a modal dialog containing: monogram + name + state chip, "Move
through the pipeline" chips, "Suggestion facts" (parents/seminary/location/age/
height), "Schools & seminaries" + an inline *Add a school* form, redt history,
references section, timeline.

| Mock element | App |
|---|---|
| Full page w/ `← Back to pipeline` | ❌ modal dialog |
| 9 tabs | ❌ none — one long scroll |
| Resume tab (parsed view, PDF, **version history**, replace) | ❌ absent |
| Photo tab (locked, "shown only to you", who-can-see-it) | ❌ absent |
| Medical tab (sensitive, never shown to child/helpers) | ❌ absent |
| Attachments (voice note / screenshot, separate from resume) | ❌ absent |
| External links (shidduch-site profiles) | ❌ absent |
| Notes tab | ❌ absent |
| AI diligence dossier (consensus/contradiction/gap) | ❌ absent |
| Right rail: child's input · reminders · forward resume · share link | ❌ absent |
| Marital status · children fields | ❌ absent |
| Catch banner in-place | ⚠️ built late, different placement |
| Identity header · state control · facts · schools | ✅ present |

**Honest score: ~20%**, not the 65% v1 claimed.

---

## 4. Corrected scorecard

| Mock screen | App surface | Status | Real match |
|---|---|---|---|
| `isLanding` | `landing/*` | ✅ built | ~85% |
| `isSignin` | `login/LoginPage` | ⚠️ divergent | auth model differs (magic-link+passkey vs password+Google) |
| `isDashboard` | `dashboard/*` | ✅ built | ~80% |
| `isBoard` | `shidduchim/ShidduchimList` | ✅ built | ~85% |
| **`isCandidates` (Shidduchim list)** | — | 🔴 **missing** | **0%** |
| `isDetail` | `shidduchim/ShidduchShow` (modal) | 🟠 partial | **~20%** |
| `isChildinput` (2nd suggestion detail) | same as above | 🟠 partial | ~20% |
| `isReference` (per-shidduch diligence) | `references/*` **as standalone** | ⚠️ **mis-placed** | wrong IA |
| `isShadchanim` | `shadchanim/ShadchanList` | ✅ built | ~75% (mock adds Redts/Looked-into/Dates columns, list/card toggle, search) |
| `isShadDetail` | `shadchanim/ShadchanShow` | ✅ built | ~75% |
| **`isTasks`** | — (**I redirected it away**) | 🔴 **missing/regressed** | **0%** |
| `isReminders` | `reminders/*` | ✅ built | ~85% |
| `isInbox` | `inbox/*` | ✅ built | ~70% |
| `isParse` | — | 🔴 missing | 0% (AI auto-fill review) |
| `isShare` | share-target (text only) | 🟠 partial | ~40% |
| `isCatch` | catch engine + panel | ✅ built | ~70% |
| `isBilling` | `billing/*` | ✅ built | ~80% |
| `isPrivacy` | `settings/*` | ⚠️ different | mock = parent↔child visibility matrix |
| `isChildhome` | `portal/*` | ✅ built | ~70% |
| `isRtl` | Hebrew on shidduch profile only | ⚠️ scoped by you | intentional |
| `isLauncher` | — | n/a | mock's own index page, not a product screen |

---

## 5. Regression I introduced

`E9a` redirected `/tasks` → `/reminders` on the basis of v1's wrong claim that
Tasks was "fully realized by Reminders". The mock's Tasks screen is **family-shared,
assigned-to-a-person, and tied to a shidduch or shadchan** — Reminders is not that.
**This is live in production and should be reverted.**

---

## 6. What I recommend (no work started)

1. **Confirm the References decision** — drop the top-level section and move
   diligence under the shidduch (keeping reference *people* reusable underneath)?
2. **Revert the `/tasks` redirect** and restore a Tasks surface.
3. **Build the Shidduchim list view** + nav entry (list/cards/search, board toggle).
4. **Rebuild the suggestion detail as a page with tabs** — the single largest gap.
5. Treat v1's remediation plan as unreliable; it was sequenced off the wrong analysis.
