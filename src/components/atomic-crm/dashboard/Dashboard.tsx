import { BookUser, Users } from "lucide-react";

import { EmptyState } from "../misc/EmptyState";
import { AttentionSection } from "./AttentionSection";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardStat } from "./DashboardStat";
import { PipelineSnapshot } from "./PipelineSnapshot";
import { RecentSuggestions } from "./RecentSuggestions";
import { useDashboardData } from "./useDashboardData";

/**
 * The magical per-child dashboard (foundation-plan §4): a greeting + child
 * switcher, the pipeline snapshot "moment", recent suggestions, directory
 * stats, and a calm "needs your attention" section — all driven from the
 * seeded shidduchim data for the selected child.
 */
export const Dashboard = () => {
  const {
    isPending,
    children,
    childId,
    setChildId,
    hasSuggestions,
    totalShadchanim,
    totalReferences,
  } = useDashboardData();

  if (isPending) return null;

  if (children.length === 0) {
    return (
      <EmptyState
        title="Add your first child"
        description="A shidduchim pipeline belongs to a child — the single you are redting for. Add a child to start tracking suggestions."
        actionLabel="Add a child"
        actionTo="/children/create"
      />
    );
  }

  const selectedChildId = childId ?? children[0].id;

  return (
    <div className="flex flex-col gap-6">
      <DashboardHeader
        childList={children}
        childId={selectedChildId}
        onSelectChild={setChildId}
      />

      {!hasSuggestions ? (
        <EmptyState
          title="Capture your first suggestion"
          description="Every redt starts here — add the first suggestion for this child to see the pipeline come to life."
          actionLabel="Add a suggestion"
          actionTo="/shidduchim/create"
        />
      ) : (
        <div className="flex flex-col gap-6">
          <PipelineSnapshot childId={selectedChildId} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <RecentSuggestions childId={selectedChildId} />
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
