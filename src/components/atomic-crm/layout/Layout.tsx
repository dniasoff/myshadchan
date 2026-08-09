import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Notification } from "@/components/admin/notification";
import { Error } from "@/components/admin/error";
import { Skeleton } from "@/components/ui/skeleton";

import { GlobalSearch, GlobalSearchProvider } from "../misc/GlobalSearch";
import { useActiveContextKindWarmer } from "../root/activeContextKindHint";
import { OnboardingGate } from "../root/OnboardingGate";
import { useSingleListingShapeHintWarmer } from "../root/singleListingShapeHint";
import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { TourAutostart } from "../tour/TourAutostart";
import { DemoBanner } from "./DemoBanner";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { AnalyticsInitializer } from "../analytics/AnalyticsInitializer";

/**
 * Desktop app shell (foundation-plan §1): a fixed left Sidebar + a column
 * holding the slim TopBar and the scrollable main content, offset by the
 * sidebar width via `--sidebar-w`. Replaces the legacy horizontal Header.
 * `OnboardingGate` wraps the whole shell so it can replace it entirely with
 * the first-run welcome; `DemoBanner` is the shell's first element so it
 * reserves its own height (see Sidebar/TopBar's `--banner-h` offset).
 */
export const Layout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  // CLS fix: warms Settings-only sections' own hints before they ever
  // mount — see each hook's own comment for why this can't live in
  // Settings (`settings/SingleListingSection.tsx`,
  // `settings/ShadchanListingSection.tsx`).
  useSingleListingShapeHintWarmer();
  useActiveContextKindWarmer();
  return (
    <OnboardingGate>
      {/* Story 4.5 (AC-1): one GlobalSearch instance for the whole desktop
          shell, so TopBar's icon and the Cmd/Ctrl+K listener it owns share
          the same dialog rather than each mounting a second one. */}
      <GlobalSearchProvider>
        <div className="ql-wash min-h-screen bg-background">
          <DemoBanner />
          <Sidebar />
          <div className="flex min-h-screen flex-col md:ps-[var(--sidebar-w)]">
            <TopBar />
            <main
              className="mx-auto w-full max-w-screen-xl flex-1 px-4 py-6 sm:px-6"
              id="main-content"
            >
              <ErrorBoundary FallbackComponent={Error}>
                <Suspense
                  fallback={<Skeleton className="h-12 w-12 rounded-full" />}
                >
                  {children}
                </Suspense>
              </ErrorBoundary>
            </main>
          </div>
          <Notification />
          <TourAutostart />
          <GlobalSearch />
          {/* Story 15.2: Initialize first-party analytics event collector */}
          <AnalyticsInitializer />
        </div>
      </GlobalSearchProvider>
    </OnboardingGate>
  );
};
