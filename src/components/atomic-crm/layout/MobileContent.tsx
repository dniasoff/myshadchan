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
 */
export const MobileContent = ({ children }: { children: ReactNode }) => (
  <main
    className="max-w-screen-xl mx-auto min-h-screen overflow-y-auto px-4
      pt-[calc(var(--mobile-header-h)+1rem)]
      pb-[calc(var(--mobile-nav-clearance)+1rem)]"
    id="main-content"
  >
    {children}
  </main>
);
