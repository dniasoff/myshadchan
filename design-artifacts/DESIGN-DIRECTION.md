# MyShadchan Design Direction — "Quiet Luminance"

Authoritative art direction for the whole app. Every screen, light and dark, is
built from this. It supersedes any ad-hoc styling. Grounded in a `ui-ux-pro-max`
design-intelligence pass (user-requested) reconciled with the approved brand.

## North star

Modern **consumer SaaS** at Linear / Vercel / Stripe-tier craft — but **calm and
dignified**, because this holds a family's private, emotionally weighty shidduchim
process. Light **and** dark are first-class and hand-designed together. **Dark mode
is the showpiece**: indigo-night with luminous accents and glass. Every screen must
read as *a work of art* — real depth, glow, refined type, purposeful motion — never
flat, generic, or "1990s admin UI" (the two looks the user explicitly rejected: the
Atomic CRM default and the imported mockup's visuals). Bilingual EN / עברית,
RTL-correct.

## Identity kept (do NOT break)

- **Indigo primary**; **amber** (`--attention` / honey) and **sage** (`--positive`)
  as semantic accents; the **7 pipeline-state colours** are the app's colour signature.
- Fonts: **Space Grotesk** (display/headings), **Inter** (body/UI), **Heebo** (Hebrew).
  Hebrew is non-negotiable — never swap to a face without real Hebrew coverage
  (this is why the skill's Lora/Raleway suggestion is rejected).
- **OKLCH token system** in `src/index.css`. **Tokens only** — no hardcoded hex/px
  colour in components.
- Vibrancy rule: **hold lightness (L), raise chroma (C)** — more vivid without
  breaking WCAG AA.

## Colour (concrete targets — express as OKLCH tokens)

**Light** — premium, softly-tinted neutral surfaces (not stark white, not muddy).
Indigo primary. Cards float on soft ambient shadow. Keep warmth via amber; a clean,
crisp parchment-adjacent base is fine, but modern and airy, not beige-heavy.

**Dark (showpiece)** — deep indigo-night base (target ≈ `#0F172A`), elevated card
surfaces (≈ `#192134`), luminous **indigo → violet** accent range (indigo ≈ `#6366F1`
→ violet ≈ `#7C3AED`), **accent-glow** halos behind primary/active elements, hairline
translucent borders (≈ `rgba(255,255,255,0.08)`). **Never pure black** (OLED smear).

The `ui-ux-pro-max` sources for this (translate any React-Native specifics —
BlurView / Reanimated / Haptics — to web/CSS: `backdrop-filter`, CSS transitions/
keyframes, no haptics):
- Style "Modern Dark (Cinema Mobile)": deep gradient base, indigo accent `#5E6AD2`,
  ambient light blobs, glass headers/nav, spring easing `cubic-bezier(0.16,1,0.3,1)`,
  scale-press `0.97`, accent glow behind primary button.
- Colour "Night indigo + dream violet on dark" and "Micro SaaS" (indigo `#6366F1`
  primary, soft violet-tinted light bg, emerald secondary accent).

## Depth & glass

- Use the elevation scale (`--shadow-xs … --shadow-xl`) consistently: soft ambient +
  tight contact shadow. One scale, no ad-hoc shadows.
- **Glassmorphism on chrome/overlays ONLY** — sidebar, top app-bar, modals, sheets,
  popovers, command palette: `backdrop-filter: blur(12–18px)`, translucent surface,
  hairline border, faint light reflection. **Not** on dense reading surfaces (tables,
  forms, long text) — readability first.
- Signature ambient: a very-low-chroma gradient wash on the app background, and an
  **accent-glow** behind the active nav item and the primary CTA.

## Typography

- Space Grotesk for display/headings (tight tracking at large sizes), Inter for
  body/UI, Heebo for Hebrew (RTL). Modular scale 12 / 14 / 16 / 18 / 24 / 32 / 40 / 56.
- Weights: 700 headings, 600 subheads, 500 labels, 400 body. Line-height 1.5 body.
- **Tabular figures** for data columns, counts, ages, dates, timers.

## Motion (CSS-only — no GSAP/Reanimated)

- Tokens: `--ease-spring: cubic-bezier(0.16,1,0.3,1)`; ease-out for enter, ease-in
  for exit (exit ≈ 60–70% of enter duration).
- Durations: 150–300ms micro-interactions; ≤400ms transitions; nothing >500ms.
- Press: scale `0.97–0.98` on tappable cards/buttons, restore on release.
- Hover/focus: smooth colour / elevation / glow transitions; **visible focus rings**
  (2–3px).
- Entrance: staggered fade + small `translateY` on list / board / dashboard items
  (30–50ms per item).
- **transform / opacity only** (never animate width/height/top/left). Respect
  `prefers-reduced-motion` (reduce or disable).

## Signature components

- **Sidebar item**: icon + label; active = indigo tint + glow + a left accent bar;
  hover = subtle surface lift. Glassy sidebar surface.
- **Card**: radius ~16px, elevated, hairline border in dark, hover lift + faint glow.
- **Primary button**: indigo, accent-glow in dark, scale-press. One primary CTA/screen.
- **7-state chips**: each pipeline state its own vivid-yet-legible token colour — the
  app's colour signature; used on the board, dashboard funnel, and detail.
- **Empty states**: warm, with an SVG illustration (never emoji) and a single action.
- **Data-viz**: pipeline distribution/funnel by state using the 7 tokens; legends,
  tabular numbers, proper empty/loading (skeleton) states.

## Guardrails

- Calm & dignified, **never salesy or garish**. Restraint is the luxury. One primary
  CTA per screen; secondary actions subordinate.
- **SVG icons only** (Lucide, already in repo) — consistent stroke width, sized via
  tokens. **No emoji as icons.**
- **WCAG AA in BOTH themes** — verify, don't assume. Borders/dividers must be visible
  in both light and dark. Modal scrims 40–60% black.
- Light and dark designed together; token-driven; no per-screen hardcoded colour.

## Pre-delivery checklist (ui-ux-pro-max)

- [ ] No emoji icons (SVG only) · [ ] cursor-pointer on clickables · [ ] hover
  transitions 150–300ms · [ ] light text contrast ≥ 4.5:1 · [ ] dark primary text
  ≥ 4.5:1, secondary ≥ 3:1 · [ ] visible focus states · [ ] prefers-reduced-motion
  respected · [ ] responsive at 375 / 768 / 1024 / 1440 · [ ] touch targets ≥ 44px ·
  [ ] one primary CTA per screen · [ ] both themes tested (not inferred from one).
