# MyShadchan Design Language — "Quiet Luminance" (implementation system)

This is the concrete, buildable expansion of `DESIGN-DIRECTION.md` ("Quiet
Luminance"). **DESIGN-DIRECTION.md is authoritative; on any conflict it wins.**
Nothing here contradicts it — it turns that direction into exact tokens, Tailwind
v4 utility patterns, and component recipes the whole app is built from.

One line: modern consumer-SaaS craft (Linear / Vercel / Stripe), **calm and
dignified**, light and dark both first-class with **dark as the showpiece** —
indigo-night surfaces, luminous indigo→violet accents, accent-glow halos,
glass-on-chrome-only, spring motion, kept fonts (Space Grotesk / Inter / Heebo)
and semantics (amber / sage + the 7 pipeline-state colours). OKLCH tokens only.
WCAG AA verified in both themes.

The foundation for all of this already exists in `src/index.css` (the "Calm
Ledger" token layer). This document **adds a thin luminance layer on top** — it
does not rewrite the base. Vibrancy rule everywhere: **hold L, raise C.**

---

## 1. Token additions (append to `src/index.css`)

All new tokens are OKLCH (or references to OKLCH). Add the runtime values under
`:root` and `.dark`, and expose the ones components consume as utilities in the
`@theme inline` block (same pattern as the existing `--color-*` / `--shadow-*`
exposures). **Do not touch existing token values** — these are additive.

### 1.1 Accent range — indigo → violet (the premium signature)

The existing `--primary` stays the trust-indigo. We add a **violet companion**
and a **gradient pair** so primary surfaces and the signature dataviz can run a
restrained indigo→violet wash (never a rainbow).

```css
:root {
  /* Violet companion to the indigo primary (hold L, raise C target ~#7C3AED) */
  --violet: oklch(0.52 0.23 300);
  --violet-foreground: oklch(0.99 0.004 95);

  /* Accent gradient stops (used ONLY on chrome accents, primary CTA sheen,
     the dashboard funnel — never on reading surfaces) */
  --accent-grad-from: oklch(0.52 0.19 268); /* = --primary */
  --accent-grad-to: oklch(0.52 0.23 300);   /* = --violet  */

  /* Accent glow — the halo behind active nav item + primary CTA. Low alpha,
     larger blur. In LIGHT it is a soft indigo bloom (subtle). */
  --glow-accent: oklch(0.52 0.19 268 / 0.28);
  --glow-accent-strong: oklch(0.52 0.19 268 / 0.40);
}
.dark {
  /* Lifted for charcoal; the showpiece glow. Indigo ~#6366F1 → violet ~#7C3AED */
  --violet: oklch(0.58 0.24 300);
  --violet-foreground: oklch(0.99 0.003 90);

  --accent-grad-from: oklch(0.62 0.21 272); /* luminous indigo */
  --accent-grad-to: oklch(0.58 0.24 300);   /* luminous violet */

  /* The dark-mode glow is the star — brighter, more chroma, still translucent */
  --glow-accent: oklch(0.62 0.22 274 / 0.45);
  --glow-accent-strong: oklch(0.64 0.23 280 / 0.60);
}
```

Expose in `@theme inline`:
```css
--color-violet: var(--violet);
--color-violet-foreground: var(--violet-foreground);
```
(Glow + gradient tokens are consumed via arbitrary-value utilities, so they do
not need `--color-*` exposure — see §5.)

### 1.2 Glass (chrome/overlays ONLY)

Sidebar, top app-bar, mobile bottom-nav, modals, sheets, popovers, command
palette. **Never** tables/forms/long text.

```css
:root {
  --glass-bg: oklch(0.99 0.004 95 / 0.72);
  --glass-border: oklch(0.52 0.02 275 / 0.10);
  --glass-blur: 14px;
}
.dark {
  /* translucent elevated indigo-night; hairline white border */
  --glass-bg: oklch(0.225 0.03 273 / 0.66);
  --glass-border: oklch(1 0 0 / 0.08);
  --glass-blur: 16px;
}
```

### 1.3 Ambient background wash (signature, very low chroma)

A single fixed radial bloom behind the whole app — the "luminance". Restraint:
one wash, low chroma, no animation.

```css
:root {
  --wash: radial-gradient(
    120% 90% at 100% 0%,
    oklch(0.52 0.19 268 / 0.05) 0%,
    transparent 55%
  );
}
.dark {
  --wash: radial-gradient(
    120% 90% at 100% 0%,
    oklch(0.58 0.24 300 / 0.10) 0%,
    transparent 55%
  );
}
```
Apply on the app root: `background-image: var(--wash);` (fixed, non-scrolling).

### 1.4 Motion tokens

```css
:root {
  --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --dur-micro: 160ms;   /* hover / focus / press */
  --dur-move: 240ms;    /* enter / layout */
  --dur-enter: 320ms;   /* staggered entrance (≤400ms) */
}
```

### 1.5 Radius

Keep `--radius: 0.875rem` (already set). Cards use `rounded-2xl` (~16px per
DESIGN-DIRECTION), controls use the derived `--radius-md/lg`. No new radius token.

---

## 2. Typography scale

Fonts are already loaded: `--font-display` (Space Grotesk), `--font-sans`
(Inter), `--font-hebrew` (Heebo). **Never** swap Hebrew away from Heebo.

Modular scale (matches DESIGN-DIRECTION 12/14/16/18/24/32/40/56):

| Role | Family | Size / line | Weight | Tracking | Tailwind |
| --- | --- | --- | --- | --- | --- |
| Display (dashboard hero) | display | 40/1.05 | 700 | -0.02em | `font-display text-[2.5rem] leading-[1.05] font-bold tracking-[-0.02em]` |
| H1 / page title | display | 32/1.1 | 700 | -0.02em | `font-display text-[2rem] font-bold tracking-tight` |
| H2 / section | display | 24/1.2 | 600 | -0.01em | `font-display text-2xl font-semibold tracking-tight` |
| H3 / card title | display | 18/1.3 | 600 | normal | `font-display text-lg font-semibold` |
| Subhead / label | sans | 14/1.4 | 600 | 0.01em | `text-sm font-semibold` |
| Body | sans | 16/1.5 | 400 | normal | `text-base` |
| Small / meta | sans | 14/1.5 | 400 | normal | `text-sm text-muted-foreground` |
| Micro / eyebrow | sans | 12/1.4 | 600 | 0.06em uppercase | `text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground` |

- **Space Grotesk** for every heading and every big number ("moment" figures).
- **Tabular figures** on all data: counts, ages, dates, timers →
  `class="tabular-nums"` (or `font-variant-numeric: tabular-nums`).
- **Hebrew**: any element rendering Hebrew gets `class="font-hebrew" dir="rtl"`.
  Bilingual identity pattern (already used in the board): English in foreground,
  Hebrew alongside in `font-hebrew text-muted-foreground`.

---

## 3. Depth & elevation

Use only the existing scale — `shadow-xs … shadow-xl` (theme-switchable). No
ad-hoc shadows.

- **Reading surfaces (cards, tiles, tables)**: `shadow-sm` at rest, `shadow-md`
  on hover. Dark mode adds a **hairline border** (`border border-border`, which
  resolves to translucent white in dark) — elevation reads via border + shadow,
  not glass.
- **Chrome/overlays**: glass (§1.2) + `shadow-lg`.
- **Primary CTA / active nav**: shadow + **accent-glow** halo (§5.3, §5.4).
- Never stack two heavy shadows; never animate shadow on scroll.

---

## 4. Motion & micro-interactions (CSS-only)

Governing rules (from DESIGN-DIRECTION, do not exceed): transform/opacity only;
150–300ms micro, ≤400ms transitions, nothing >500ms; ease-out enter / ease-in
exit; **respect `prefers-reduced-motion`**.

### 4.1 Press
Tappable cards & buttons: `active:scale-[0.97] transition-transform
duration-[160ms] ease-[--ease-spring]`. Restore on release.

### 4.2 Hover / focus
- Hover: colour + elevation + glow transitions, `transition-[color,box-shadow,
  transform] duration-[160ms] ease-[--ease-out]`; cards lift
  `hover:-translate-y-0.5`.
- Focus: **always-visible ring**, `focus-visible:ring-2 focus-visible:ring-ring
  focus-visible:ring-offset-2 focus-visible:ring-offset-background outline-none`.

### 4.3 Staggered entrance
List / board / dashboard items fade + rise on mount. CSS-only via a keyframe and
a per-item `animation-delay` set inline from the item index (30–50ms step, cap
the delay ~8 items so nothing feels slow).

Add once to `index.css`:
```css
@keyframes ql-rise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.ql-enter {
  animation: ql-rise var(--dur-enter) var(--ease-out) both;
}
@media (prefers-reduced-motion: reduce) {
  .ql-enter { animation: none; }
  * { scroll-behavior: auto; }
}
```
Usage: `<div className="ql-enter" style={{ animationDelay: \`${i * 40}ms\` }}>`.
**Always** pair with the reduced-motion guard above.

### 4.4 The signature "moment"
On the dashboard, the pipeline distribution bar **grows its segments** on mount
(scaleX from 0, transform-origin left/inline-start, staggered per state) — one
calm, deliberate reveal, ≤400ms, then still. This is the app's hero motion; do
not add others competing with it on the same screen.

---

## 5. Signature component recipes (copy-pasteable Tailwind v4)

Tokens only — no hardcoded hex/px colour. Arbitrary values reference CSS vars,
e.g. `bg-[--glass-bg]`, `shadow-[0_0_0_1px_var(--glass-border)]`.

### 5.1 Card
```tsx
<div className="rounded-2xl bg-card text-card-foreground border border-border
  shadow-sm transition-[box-shadow,transform] duration-[160ms] ease-[--ease-out]
  hover:shadow-md hover:-translate-y-0.5 p-5">
```

### 5.2 Glass chrome surface (sidebar / top-bar / bottom-nav / sheet)
```tsx
<aside className="bg-[--glass-bg] backdrop-blur-[var(--glass-blur)]
  border-[--glass-border] border-e shadow-lg">
```
(`border-e` = inline-end, RTL-correct. Top-bar uses `border-b`, bottom-nav
`border-t`.)

### 5.3 Primary button (one per screen)
```tsx
<button className="inline-flex items-center gap-2 rounded-xl px-4 h-11
  font-semibold text-primary-foreground
  bg-[linear-gradient(135deg,var(--accent-grad-from),var(--accent-grad-to))]
  shadow-sm shadow-[0_8px_24px_-6px_var(--glow-accent)]
  transition-[transform,box-shadow] duration-[160ms] ease-[--ease-spring]
  hover:shadow-[0_10px_30px_-6px_var(--glow-accent-strong)]
  active:scale-[0.97]
  focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
  focus-visible:ring-offset-background outline-none">
```
Restraint: the gradient is 135° indigo→violet, low travel. Secondary actions are
`variant="ghost"` / `bg-secondary` — never a second gradient on the same screen.

### 5.4 Sidebar item (icon + label; active = tint + glow + left accent bar)
```tsx
// Active
<a className="group relative flex items-center gap-3 rounded-xl px-3 h-11
  font-medium text-primary
  bg-[color-mix(in_oklch,var(--primary)_12%,transparent)]
  shadow-[0_0_24px_-8px_var(--glow-accent)]
  transition-colors duration-[160ms]">
  <span className="absolute inset-y-1.5 start-0 w-1 rounded-full
    bg-[linear-gradient(var(--accent-grad-from),var(--accent-grad-to))]" />
  <Icon className="size-5" /> <span>Pipeline</span>
</a>
// Rest
<a className="flex items-center gap-3 rounded-xl px-3 h-11 font-medium
  text-muted-foreground hover:text-foreground hover:bg-secondary
  transition-colors duration-[160ms]">
```
Icons: Lucide, `size-5`, consistent stroke. **No emoji.**

### 5.5 The 7-state chip (the colour signature)
Drive every chip from the state's token (`--st-new … --st-no`, already defined in
both themes and mapped in `pipelineStates.ts` via `token`). Chip = tinted surface
+ solid dot:
```tsx
<span className="inline-flex items-center gap-1.5 rounded-full ps-2 pe-2.5 h-6
  text-xs font-semibold tabular-nums
  text-[var(--st-look)]
  bg-[color-mix(in_oklch,var(--st-look)_16%,transparent)]
  ring-1 ring-[color-mix(in_oklch,var(--st-look)_28%,transparent)]">
  <span className="size-2 rounded-full bg-[var(--st-look)]" /> Look-into
</span>
```
Build one `<StateChip state={PipelineState} />` component that reads
`getPipelineStateDef(state).token` and injects it as a CSS var via `style` — so
the chip is token-driven, never a switch of hardcoded classes. Keep the **gut
For-sure-not (`--st-fsn`, quiet grey)** visibly distinct from **post-look No
(`--st-no`, clay)**.

### 5.6 Pipeline distribution / funnel (dashboard dataviz — the "moment")
A single horizontal bar segmented by the 7 states, each segment its token colour,
width = share of that child's suggestions; a legend below with tabular counts.
Segments `scaleX` in on mount (§4.4). Empty state = a calm dashed rail + "No
suggestions yet". Loading = a `shadow`-less skeleton rail. Never a pie, never 3-D.

### 5.7 Empty states
Warm, centered, one action. **SVG illustration (never emoji)** — a simple
line-art motif (e.g. an open ledger / envelope) in `text-muted-foreground` at low
opacity, a one-line reassurance, a single primary button. Copy is calm and
teaching (mockup §9 tone): *"Nothing to review — you're on top of it."*

### 5.8 Attention (honey) surface — the "catch"/nudge treatment
Overdue reminders and future catches use the honey family (never red):
`bg-attention text-attention-foreground` for the strong fill, or
`bg-[color-mix(in_oklch,var(--attention)_18%,transparent)]` tint for a calm
banner. Relief, not alarm.

---

## 6. Gradient / wash restraint rules

1. **One ambient wash** per screen (the fixed `--wash`), nothing else full-bleed.
2. Indigo→violet gradients appear **only** on: the primary CTA, the active
   sidebar accent bar, and the dashboard funnel/hero number. Never on cards,
   never on text blocks, never as a section background.
3. No gradient on any dense reading surface (tables, forms, timelines).
4. Glass only on chrome/overlays (§1.2). If it scrolls dense content, it is not
   glass.
5. When unsure, remove the effect. **Restraint is the luxury.**

---

## 7. Bilingual / RTL

- Use **logical properties** everywhere: `ms-/me-/ps-/pe-`, `start-/end-`,
  `border-s/border-e`, `text-start`. No `left/right` in layout.
- Hebrew nodes: `font-hebrew dir="rtl"`. The app already ships bilingual state
  labels (`labelHe`) and bilingual identity fields on the board — reuse them.
- Icons that imply direction (chevrons, back) must mirror under RTL.

---

## 8. Accessibility (WCAG AA, BOTH themes — verify, don't assume)

- Body/primary text ≥ 4.5:1; large text & secondary ≥ 3:1 — in light **and** dark.
- The token base already holds these; when raising vibrancy, **hold L, raise C**
  so contrast is preserved. Any new tinted-on-tint chip must be checked against
  its background in both themes.
- Focus rings always visible (§4.2). Touch targets ≥ 44px (`h-11`/`h-12`).
- Modal scrims 40–60% black. Borders/dividers visible in both themes (dark uses
  translucent-white `--border`).
- `prefers-reduced-motion`: entrance + press animations disabled (§4.3).

---

## 9. Pre-commit checklist (every screen)

- [ ] Tokens only — no hardcoded hex/px colour.
- [ ] SVG/Lucide icons only — no emoji as icons.
- [ ] Glass only on chrome/overlays; reading surfaces are solid.
- [ ] One primary CTA; secondary actions subordinate.
- [ ] Space Grotesk on headings + big numbers; Heebo on all Hebrew; tabular-nums
      on data.
- [ ] Logical properties (RTL-safe); one Hebrew surface sanity-checked.
- [ ] Focus rings visible; targets ≥ 44px; contrast AA in light **and** dark.
- [ ] `prefers-reduced-motion` honoured; motion transform/opacity only, ≤400ms.
- [ ] Calm and dignified — nothing salesy, garish, or gamified.
</content>
</invoke>
