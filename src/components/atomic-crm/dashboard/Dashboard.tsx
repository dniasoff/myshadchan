import { BookUser, Users } from "lucide-react";

import { EmptyState } from "../misc/EmptyState";
import { AttentionSection } from "./AttentionSection";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardStat } from "./DashboardStat";
import { PipelineSnapshot } from "./PipelineSnapshot";
import { RecentSuggestions } from "./RecentSuggestions";
import { useDashboardData } from "./useDashboardData";

/**
 * The magical per-single dashboard (foundation-plan §4): a greeting + single
 * switcher, the pipeline snapshot "moment", recent suggestions, directory
 * stats, and a calm "needs your attention" section — all driven from the
 * seeded shidduchim data for the selected single.
 */
export const Dashboard = () => {
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
      <EmptyState
        title="Add your first single"
        description="A shidduchim pipeline belongs to a single — the person you are redting for. Add a single to start tracking suggestions."
        actionLabel="Add a single"
        actionTo="/singles/create"
      />
    );
  }

  const selectedSingleId = singleId ?? singles[0].id;

  return (
    <div className="flex flex-col gap-6">
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
        <div className="flex flex-col gap-6">
          <PipelineSnapshot singleId={selectedSingleId} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <RecentSuggestions singleId={selectedSingleId} />
            </div>
            <div className="flex flex-col gap-6 lg:col-span-4">
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
