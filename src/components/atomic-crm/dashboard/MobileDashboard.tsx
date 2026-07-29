import { Users } from "lucide-react";
import type { ReactNode } from "react";

import { buildNewPath } from "../entity360/entityPaths";
import MobileHeader from "../layout/MobileHeader";
import { EmptyState } from "../misc/EmptyState";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { AttentionSection } from "./AttentionSection";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardStat } from "./DashboardStat";
import { PipelineSnapshot } from "./PipelineSnapshot";
import { RecentSuggestions } from "./RecentSuggestions";
import { useDashboardData } from "./useDashboardData";

/**
 * `MobileLayout` supplies the `<MobileContent>` wrapper (ui-audit-plan.md
 * S3) — this only renders the fixed header; wrapping in `<MobileContent>`
 * again here would nest a second `<main id="main-content">` and double the
 * page's top/bottom padding.
 */
const Wrapper = ({ children }: { children: ReactNode }) => {
  const { darkModeLogo, lightModeLogo, title } = useConfigurationContext();
  return (
    <>
      <MobileHeader>
        <div className="flex items-center gap-2 text-secondary-foreground no-underline py-3">
          <img
            className="[.light_&]:hidden h-6"
            src={darkModeLogo}
            alt={title}
          />
          <img
            className="[.dark_&]:hidden h-6"
            src={lightModeLogo}
            alt={title}
          />
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
      </MobileHeader>
      {children}
    </>
  );
};

/** Same dashboard sections as `Dashboard`, stacked single-column for mobile. */
export const MobileDashboard = () => {
  const {
    isPending,
    singles,
    singleId,
    setSingleId,
    hasSuggestions,
    totalShadchanim,
  } = useDashboardData();

  if (isPending) return null;

  if (singles.length === 0) {
    return (
      <Wrapper>
        <EmptyState
          title="Add your first single"
          description="A shidduchim pipeline belongs to a single — the person you are redting for. Add a single to start tracking suggestions."
          actionLabel="Add a single"
          actionTo={buildNewPath("singles")}
        />
      </Wrapper>
    );
  }

  const selectedSingleId = singleId ?? singles[0].id;

  return (
    <Wrapper>
      <div className="flex flex-col gap-5">
        <DashboardHeader
          singleList={singles}
          singleId={selectedSingleId}
          onSelectSingle={setSingleId}
        />

        {!hasSuggestions ? (
          <EmptyState
            title="Capture your first suggestion"
            description="Every redt starts here — add the first suggestion for this single to see the pipeline come to life."
            actionLabel="Add a suggestion"
            actionTo={buildNewPath("shidduchim")}
          />
        ) : (
          <>
            <PipelineSnapshot singleId={selectedSingleId} />
            <RecentSuggestions singleId={selectedSingleId} />
            <DashboardStat
              label="Shadchanim"
              value={totalShadchanim}
              icon={Users}
              to="/shadchanim"
            />
            <AttentionSection />
          </>
        )}
      </div>
    </Wrapper>
  );
};
