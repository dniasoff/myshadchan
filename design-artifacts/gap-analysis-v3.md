# MyShadchan — Gap Analysis **v3** (from the full design export)

**Supersedes v1 and v2.** v1 was unreliable (it guessed screen identity from filenames);
v2 corrected the worst errors but was still written without the design export.
This version is written from the complete package now committed at `mockup/`.

---

## 1. How this was produced

| Source | What it settles |
|---|---|
| `mockup/MyShadchan.dc.html` — **its JS state**, not just its markup | The real nav (`navDef`) and the real tab arrays. This is what earlier versions guessed at. |
| `mockup/screenshots/*.png` (94 files, 68 unique) | Rendered visual intent. **These are design iterations — some are stale** (early ones show a nav item "Candidates" and only 4 detail tabs). Where a screenshot and `.dc.html` disagree, **`.dc.html` wins**. |
| `mockup/uploads/prd.md`, `ARCHITECTURE-SPINE.md`, `SOLUTION-DESIGN.md` | The requirements behind each screen. |
| `mockup/support.js` | The comp runtime. |
| The app source under `src/components/atomic-crm/` | What is actually built, wired and routed. |

Scoring is deliberately harsh. A feature on the **wrong surface** is *misplaced*, not *built*.
A feature the app **removed** is *regressed*, not *missing*.

---

## 2. Headline

Roughly **half** the design is realised, but the half that's missing includes the
product's centre of gravity. The **suggestion 360° view — the single most important
screen — is at ~15%**: the design is a full page with nine tabs and a right rail; the
app renders a cramped modal with three sections. The **information architecture is
wrong in three specific ways**: the `Shidduchim` list doesn't exist, `Tasks` was
deleted by this project (a regression now live in production), and `References` is a
top-level section when the design makes it per-shidduch diligence. Supporting screens
(board, dashboard, reminders, billing, landing) are genuinely good. The capture funnel
and the AI/diligence layer are largely unbuilt.

---

## 3. Information architecture — the structural story

The mock's own nav definition:

```js
navDef=[["dashboard","Dashboard"],["inbox","Inbox"],["board","Pipeline"],
        ["candidates","Shidduchim"],["shadchanim","Shadchanim"],
        ["tasks","Tasks"],["reminders","Reminders"],["privacy","Settings"]]
```

| # | Design (8) | App (7) | Verdict |
|---|---|---|---|
| 1 | Dashboard | Dashboard | ok |
| 2 | Inbox | Inbox | ok (order differs) |
| 3 | Pipeline | Pipeline | ok |
| 4 | **Shidduchim** | — | 🔴 **missing entirely** |
| 5 | Shadchanim | Shadchanim | ok |
| 6 | **Tasks** | — | 🔴 **regressed — deleted by this project** |
| 7 | Reminders | Reminders | ok |
| 8 | Settings | Settings | ok |
| — | *(none)* | **References** | ⚠️ **should not be top-level** |

Note the screen keyed `candidates` is **labelled "Shidduchim"** — v1 mistook it for a
children roster and marked it "built", which is how a whole nav destination went
unnoticed.

---

## 4. Scorecard (worst first)

| Mock screen | App surface | Status | Match | Headline gap |
|---|---|---|---|---|
| `isParse` — AI "Confirm the details" | — | 🔴 missing | **0%** | No resume auto-fill review at all |
| `isCandidates` — **Shidduchim list** | — | 🔴 missing | **0%** | No list view, no search, no List/Cards toggle, no nav entry |
| `isTasks` — family tasks | — (redirected away) | 🔴 **regressed** | **0%** | Assigned, family-shared, target-linked tasks deleted |
| `isDetail` / `isChildinput` — 360° view | `ShidduchShow` (modal) | 🟠 partial | **~15%** | 9 tabs + right rail → 3 sections in a dialog |
| `isShare` — share-target | manifest + `/share` shim | 🟠 partial | ~30% | Text only; no source tabs, no link-to-existing, no attribution step |
| `isSignin` | `login/LoginPage` | ⚠️ divergent | ~35% | Design is magic-link + passkey + 18+; app is password + Google |
| `isPrivacy` — transparency | `settings/SettingsPage` | 🟠 partial | ~35% | No parent↔child matrix, no dignity floor, no sub-processor disclosure |
| `isReference` + `refOverlays` | `references/*` **standalone** | ⚠️ **misplaced** | ~40% | Right mechanics, wrong surface; no diligence workspace screen |
| `isShadDetail` | `ShadchanShow` | 🟠 partial | ~45% | No tabs, no contact actions, no reminders-on-shadchan |
| `isChildhome` — child portal | `portal/*` | 🟠 partial | ~55% | Read-only; the child cannot send input back |
| `isShadchanim` — book | `ShadchanList` | 🟠 partial | ~60% | No search, no List/Cards toggle, wrong stat columns |
| `isInbox` | `inbox/*` | ✅ built | ~65% | No ambiguous-sender attribution step |
| `isCatch` | catch engine + panel | ✅ built | ~70% | Prior-date detection only when corroborated |
| `isReminders` | `reminders/*` | ✅ built | ~80% | Cosmetic label differences |
| `isBilling` | `billing/*` | ✅ built | ~80% | Payment stubbed (deliberate) |
| `isDashboard` | `dashboard/*` | ✅ built | ~80% | — |
| `isBoard` — pipeline | `ShidduchimList` | ✅ built | ~85% | Strongest screen in the app |
| `isLanding` | `landing/*` | ✅ built | ~85% | — |
| `isRtl` | profile only | ⚪ intentional | n/a | Hebrew deliberately scoped to the shidduch profile |
| `isLauncher` | — | ⚪ n/a | n/a | The comp's own index page, not a product screen |

---

## 5. The suggestion 360° view — the biggest gap

Design tabs (from the comp's own array):

```js
[["resume","Profile"],["resumedoc","Resume"],["photo","Photo"],["medical","Medical"],
 ["attach","Attachments"],["refs","References & diligence"],["external","External links"],
 ["notes","Notes"],["timeline","Timeline"]]
```

| Tab / element | Design | App today |
|---|---|---|
| **Page** with `← Back to pipeline` | full-width page + right rail | ❌ routed **modal dialog** |
| Tab bar (9 tabs) | ✅ | ❌ none — one scroll |
| **Profile** | Hebrew name, age/DOB (Hebrew date), height, background (FFB), location, shul, current + earlier yeshiva, father, mother | 🟠 partial — parents/seminary/location/age/height only |
| **Resume** | rendered doc, page N of M, Download PDF, **Replace resume**, **version history (3 versions)** | ❌ absent |
| **Photo** | locked "tap to view", upload/replace/hide, *"Shown only to you. Never included in a share unless you choose"*, **who can see it** | ❌ absent |
| **Medical** | sensitive; *"visible only to you — never shown to Rivky or helpers"*, add medical note | ❌ absent |
| **Attachments** | voice notes/screenshots, *"kept separate from the resume"* | ❌ absent |
| **References & diligence** | the workspace (see §6) | 🟠 a section, not the workspace |
| **External links** | shidduch-site profiles (ZUUG, ClickShadchan), add link | ❌ absent |
| **Notes** | ✅ | ❌ absent |
| **Timeline** | ✅ | ✅ present |
| Header: **Set decision** dropdown | ✅ | 🟠 as a 7-chip row |
| Header: **marital status** (Never married / Divorced / Widowed) | ✅ | ❌ absent |
| Header: **children** | ✅ | ❌ absent |
| **Catch banner** in place | *"First suggested by Mrs. Feldman 3 months ago · possible prior date (Feb 2026)"* | 🟠 built late, different placement |
| **AI diligence dossier** (paid) | Consensus / Contradiction / **Gap** + "Open reference workspace →" | ❌ absent |
| Right rail: **Rivky's input** | the child's note back to the parent | ❌ absent |
| Right rail: **Reminders on this suggestion** | ✅ | ❌ absent |
| Right rail: **Forward resume** (lands in their tasks) | ✅ | ❌ absent |
| Right rail: **Share via link** | ✅ | ❌ absent |

**~15%.** v1 called this 65%.

---

## 6. References & diligence — the IA correction

**Confirmed decision:** a reference person **can** serve multiple shidduchim, **but the
user must be made aware**. The design implements exactly that:

> `← Dovid Berkowitz · 360° view` → **References — Dovid Berkowitz**
> *"Diligence for this suggestion · 1 of 3 spoken to"*
> **People to speak to:** Rabbi Weiss — *"↻ You've spoken to him about 2 other boys"*;
> Mrs. Schwartz — *"↻ First time speaking with her"*

So: keep the many-to-many model, **delete the top-level section**, and surface reuse
inline at the moment of use.

| Piece | Exists? | Now | Should be |
|---|---|---|---|
| Reference ↔ shidduch many-to-many | ✅ `reference_links` | — | unchanged, **no migration** |
| "Spoken to him about N other boys" | ✅ `RepeatRecognitionPanel` | standalone `ReferenceShow` | inline in the workspace list |
| "You already have this person" on entry | ✅ `ReferenceMatchPanel` | standalone `ReferenceCreate` | when adding a reference **to a shidduch** |
| Per-shidduch references section | ✅ `ShidduchReferencesSection` | already in `ShidduchShow` | grows into the workspace |
| Call logging | ✅ `CallCaptureSheet` / `ReferenceCallLog` | standalone | in the workspace |
| **"N of M spoken to" progress** | ⚠️ meter exists per-reference | wrong scope | per-shidduch |
| **"People to speak to" list** | ❌ | — | new |
| **Call outcomes** (Answered / No answer / Call back / They'll call back) | 🟠 partial | — | 4 explicit outcomes |
| **Relationship-tailored questions** | ✅ `relationshipQuestions.ts` | standalone | in the call panel |
| **Cross-reference summary** ("did we ask…") | ✅ `crossReferenceSummary.ts` | standalone | workspace header |
| **Top-level References nav** | ⚠️ exists | nav | **remove** |

**This is relocation plus one new screen — not a rebuild.** Most mechanics are written.

---

## 7. Genuinely missing (with the data each needs)

| Missing | Data model it implies |
|---|---|
| Resume document + **version history** | resume files per shidduch, versioned; `resumes` table exists but is barely used |
| Photo with per-item visibility | photo asset + visibility ("private / spouse / Rivky") |
| Medical notes (sensitive tier) | a note class never visible to child or helpers |
| Attachments (voice notes, screenshots) | attachment set distinct from the resume |
| External links | link list per shidduch |
| Notes tab | notes per shidduch |
| **Shidduchim list view** | none — a view over existing data |
| **Tasks** (assigned, family-shared) | `tasks` has target_type/target_id; needs **assignee** |
| Marital status / children | two columns on `shidduchim` |
| AI diligence dossier | inference + the entitlement gate (built) |
| AI resume auto-parse | OCR/LLM + review UI |
| Child input back to parent | portal write path (portal is read-only today) |
| Parent↔child transparency matrix | derivable from `visibility` + `is_child_visible_state` |
| Magic-link / passkey auth | Supabase supports both; app uses password + Google |

---

## 8. Regressions this project introduced

1. **`/tasks` → `/reminders` redirect** (`root/CRM.tsx:276`). Justified by v1's false claim
   that Reminders "fully realizes" Tasks. The design's Tasks is *"shared across the family —
   each task is tied to a shidduch or shadchan, and **assigned to a person**"*; Reminders is a
   personal nudge list. **Live in production. Should be reverted.**
2. **Top-level `References` nav** was reinforced (E9/E5 polish) rather than questioned, moving
   the app further from the design's IA.

---

## 9. Prioritised backlog

### P0 — restore the shape of the product
| # | Work | Effort | Unblocks |
|---|---|---|---|
| 1 | Rebuild the 360° view as a **page with the 9 tabs + right rail** | **L** | Resume, Photo, Medical, Attachments, External links, Notes, diligence entry |
| 2 | **Shidduchim list** view + nav entry (search, List/Cards, board switch) | **M** | The missing nav destination |
| 3 | **Revert `/tasks`**; build Tasks (assignee + family sharing + target link) | **M** | Removes a live regression |
| 4 | **Relocate References** under the shidduch; delete the top-level section | **M** | The IA correction you asked for |

### P1 — the diligence + capture value
| # | Work | Effort |
|---|---|---|
| 5 | Reference **workspace** screen ("people to speak to", N of M, inline reuse awareness, 4 call outcomes, tailored questions) | **M** |
| 6 | Resume storage + **version history** + Forward/Share actions | **M** |
| 7 | Share-target: source tabs, attribution, **link to existing suggestion** | **M** |
| 8 | Child **input back** from the portal → the detail's right rail | **S–M** |
| 9 | Shadchan detail: 3 tabs, contact actions, reminders-on-shadchan | **S–M** |

### P2 — completeness
| # | Work | Effort |
|---|---|---|
| 10 | Privacy/transparency screen (matrix, dignity floor, sub-processors) | **S–M** |
| 11 | Shadchanim list search + List/Cards + correct stat columns | **S** |
| 12 | Marital status / children fields | **S** |
| 13 | AI dossier + resume auto-parse (needs the AI layer) | **L** |
| 14 | Auth model decision: magic-link/passkey vs password+Google | **M** |

---

## 10. What I am *not* claiming

- I did **not** re-verify every screen by running the app; scoring for built screens leans
  on source reading plus earlier screenshots, which may now be stale.
- Percentages are judgement, not measurement — use the gap tables, not the numbers.
- I have not read `prd.md` / `ARCHITECTURE-SPINE.md` end to end; FR/AD numbers are not
  cross-referenced here. If you want requirement-level traceability, that's a separate pass.
- Dark mode and mobile parity for the design's screens were not re-checked in this version.
- The intended fix for References is **relocation**, but I have not designed the migration of
  existing standalone reference records into that flow.
