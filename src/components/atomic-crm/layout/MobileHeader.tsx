import { useLayoutEffect } from "react";

/**
 * The mobile shell's fixed page header. Rendered by the three routes that own
 * one (Dashboard, Tasks, Settings) — never by `MobileLayout`.
 *
 * Being `fixed` costs it two things the rest of the shell gets for free:
 *
 * 1. It has to offset itself against the demo banner. `DemoBanner` is
 *    `sticky top-0 z-40` and opaque, so a header at `top-0` spends every
 *    demo session — the default first-run state — completely painted over:
 *    no logo, no page title. `Sidebar`/`TopBar` already offset against the
 *    banner's published `--banner-h`; this does the same. Only the fixed bar
 *    needs it: the banner keeps its height in normal flow, so `MobileContent`
 *    is pushed below it already and adding `--banner-h` to that padding too
 *    would double-count the banner.
 * 2. It has to announce that it exists. `MobileContent` wraps EVERY mobile
 *    route but only these three render a header, so a flat
 *    `--mobile-header-h` of clearance left the other routes opening with 72px
 *    of blank space. Publishing `--mobile-header-active` on mount (and
 *    dropping it on unmount, as `DemoBanner` does for `--banner-h`) makes the
 *    clearance opt-in from the route that actually owns the bar.
 *
 * `useLayoutEffect`, not `useEffect`: the variable has to be set before the
 * browser paints, or every header route would paint with no clearance and
 * then shift its content down — trading one route's wasted space for another
 * route's layout shift.
 */
const MobileHeader = ({ children }: { children: React.ReactNode }) => {
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--mobile-header-active",
      "var(--mobile-header-h)",
    );
    return () => {
      document.documentElement.style.removeProperty("--mobile-header-active");
    };
  }, []);

  return (
    <header className="fixed top-[var(--banner-h,0px)] left-0 right-0 z-10 flex h-(--mobile-header-h) w-full items-center justify-between bg-secondary px-4">
      {children}
    </header>
  );
};

export default MobileHeader;
