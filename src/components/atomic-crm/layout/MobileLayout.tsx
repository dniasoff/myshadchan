import { Error } from "@/components/admin/error";
import { Notification } from "@/components/admin/notification";
import { Skeleton } from "@/components/ui/skeleton";
import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { GlobalSearch, GlobalSearchProvider } from "../misc/GlobalSearch";
import { useActiveContextKindWarmer } from "../root/activeContextKindHint";
import { OnboardingGate } from "../root/OnboardingGate";
import { useSingleListingShapeHintWarmer } from "../root/singleListingShapeHint";
import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { TourAutostart } from "../tour/TourAutostart";
import { DemoBanner } from "./DemoBanner";
import { MobileContent } from "./MobileContent";
import { MobileNavigation } from "./MobileNavigation";

/**
 * `OnboardingGate` wraps the whole shell (see `Layout.tsx`'s desktop
 * counterpart) so it can replace it entirely with the first-run welcome.
 * `DemoBanner` is the shell's first element — no sidebar to offset on
 * mobile, so content already flows below it and `MobileNavigation` (a fixed
 * bottom bar) is unaffected.
 *
 * `MobileContent` wraps `{children}` unconditionally (ui-audit-plan.md S3):
 * the shell imposes its own gutter, `#main-content` landmark and bottom-bar
 * clearance on every mobile route, rather than each route remembering to
 * opt in — previously true for 3 of 8 routes and silently absent on the
 * other 5. A route that renders its own fixed `<MobileHeader>` (Dashboard,
 * Tasks, Settings) still does — `MobileContent` only ever wraps once, here.
 */
export const MobileLayout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  // CLS fix: warms Settings-only sections' own hints before they ever
  // mount — see each hook's own comment for why this can't live in
  // Settings (`settings/SingleListingSection.tsx`,
  // `settings/ShadchanListingSection.tsx`).
  useSingleListingShapeHintWarmer();
  useActiveContextKindWarmer();
  return (
    <OnboardingGate>
      {/* Story 4.5 (AC-1): the mobile counterpart of Layout.tsx's provider —
          MobileNavigation's "More" menu item opens this SAME instance. */}
      <GlobalSearchProvider>
        <DemoBanner />
        <ErrorBoundary FallbackComponent={Error}>
          <Suspense fallback={<Skeleton className="h-12 w-12 rounded-full" />}>
            <MobileContent>{children}</MobileContent>
          </Suspense>
        </ErrorBoundary>
        <MobileNavigation />
        <Notification
          mobileOffset={{
            bottom: "calc(var(--mobile-nav-clearance) + 0.5rem)",
          }}
        />
        <TourAutostart />
        <GlobalSearch />
      </GlobalSearchProvider>
    </OnboardingGate>
  );
};
