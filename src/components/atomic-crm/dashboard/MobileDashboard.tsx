import { BookUser, Users } from "lucide-react";
import type { ReactNode } from "react";

import MobileHeader from "../layout/MobileHeader";
import { MobileContent } from "../layout/MobileContent";
import { EmptyState } from "../misc/EmptyState";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { AttentionSection } from "./AttentionSection";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardStat } from "./DashboardStat";
import { PipelineSnapshot } from "./PipelineSnapshot";
import { RecentSuggestions } from "./RecentSuggestions";
import { useDashboardData } from "./useDashboardData";

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
      <MobileContent>{children}</MobileContent>
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
    totalReferences,
  } = useDashboardData();

  if (isPending) return null;

  if (singles.length === 0) {
    return (
      <Wrapper>
        <EmptyState
          title="Add your first single"
          description="A shidduchim pipeline belongs to a single — the person you are redting for. Add a single to start tracking suggestions."
          actionLabel="Add a single"
          actionTo="/singles/create"
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
            actionTo="/shidduchim/create"
          />
        ) : (
          <>
            <PipelineSnapshot singleId={selectedSingleId} />
            <RecentSuggestions singleId={selectedSingleId} />
            <div className="grid grid-cols-2 gap-4">
              <DashboardStat
                label="Shadchanim"
                value={totalShadchanim}
                icon={Users}
                to="/shadchanim"
              />
              <DashboardStat
                label="References"
                value={totalReferences}
                icon={BookUser}
                to="/references"
              />
            </div>
            <AttentionSection />
          </>
        )}
      </div>
    </Wrapper>
  );
};
