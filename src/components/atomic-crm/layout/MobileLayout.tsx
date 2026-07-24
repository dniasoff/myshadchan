import { Error } from "@/components/admin/error";
import { Notification } from "@/components/admin/notification";
import { Skeleton } from "@/components/ui/skeleton";
import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { OnboardingGate } from "../root/OnboardingGate";
import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { TourAutostart } from "../tour/TourAutostart";
import { DemoBanner } from "./DemoBanner";
import { MobileNavigation } from "./MobileNavigation";

/**
 * `OnboardingGate` wraps the whole shell (see `Layout.tsx`'s desktop
 * counterpart) so it can replace it entirely with the first-run welcome.
 * `DemoBanner` is the shell's first element — no sidebar to offset on
 * mobile, so content already flows below it and `MobileNavigation` (a fixed
 * bottom bar) is unaffected.
 */
export const MobileLayout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  return (
    <OnboardingGate>
      <DemoBanner />
      <ErrorBoundary FallbackComponent={Error}>
        <Suspense fallback={<Skeleton className="h-12 w-12 rounded-full" />}>
          {children}
        </Suspense>
      </ErrorBoundary>
      <MobileNavigation />
      <Notification mobileOffset={{ bottom: "72px" }} />
      <TourAutostart />
    </OnboardingGate>
  );
};
