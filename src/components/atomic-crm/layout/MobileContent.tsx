import { type ReactNode } from "react";

/**
 * The mobile shell's one content wrapper (ui-audit-plan.md S3/S4): page
 * gutter, the `#main-content` landmark, and clearance under the fixed
 * `MobileHeader` / above the fixed `MobileNavigation`. Mounted exactly once,
 * by `MobileLayout`, around every route's content — a route never wraps
 * itself in this again (that produced a nested `<main>` and doubled
 * padding). Top/bottom padding are the fixed-bar tokens plus a 1rem gap,
 * so a bar resizing in `index.css` moves this clearance with it instead of
 * silently drifting out of sync.
 *
 * Three traps this wrapper has already fallen into, one per class here:
 * - `min-h-dvh`, never `min-h-screen`: `100vh` is the viewport with the
 *   browser toolbars COLLAPSED, so every page was ~60-100px taller than the
 *   visible area and scrolled even when its content fit.
 * - no `overflow-y-auto`: with `min-h-` (not `h-`) this element grows rather
 *   than scrolls, so the class only ever made it a scroll container that
 *   never scrolls — which swallows overscroll/pull-to-refresh AND silently
 *   re-parents every `position: sticky` descendant (a form's Save toolbar)
 *   onto a scrollport that never moves.
 * - `--mobile-header-active`, not `--mobile-header-h`: only 3 of the ~10
 *   mobile routes render a `MobileHeader`, and that component publishes the
 *   variable while it is mounted. Reserving the bar's height unconditionally
 *   opened every other route with 72px of nothing.
 */
export const MobileContent = ({ children }: { children: ReactNode }) => (
  <main
    className="max-w-screen-xl mx-auto min-h-dvh px-4
      pt-[calc(var(--mobile-header-active,0px)+1rem)]
      pb-[calc(var(--mobile-nav-clearance)+1rem)]"
    id="main-content"
  >
    {children}
  </main>
);
