import { Users } from "lucide-react";

import { CanAccess } from "ra-core";

import { buildNewPath } from "../entity360/entityPaths";
import { EmptyState } from "../misc/EmptyState";
import { AttentionSection } from "./AttentionSection";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardStat } from "./DashboardStat";
import { DueRemindersCard } from "./DueRemindersCard";
import { MetricsCards } from "./MetricsCards";
import { ParentFocusCards } from "./ParentFocusCards";
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
  } = useDashboardData();

  if (isPending) return null;

  if (singles.length === 0) {
    return (
      <EmptyState
        title="Add your first single"
        description="A shidduchim pipeline belongs to a single — the person you are redting for. Add a single to start tracking suggestions."
        actionLabel="Add a single"
        actionTo={buildNewPath("singles")}
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
          actionTo={buildNewPath("shidduchim")}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {/* The four questions a parent opens this page to answer. See
              parentFocus.ts for why these four, in this order. */}
          <ParentFocusCards singleId={selectedSingleId} />
          {/* Story 15.2's north-star and counter-metrics (cross-account leaks,
              mis-routed items, duplicate false-positive rate, trial-to-paid,
              AI cost per family) measure whether the PRODUCT is working. They
              used to render for every family, which told a parent nothing
              about their own child and was account-wide on an otherwise
              per-single page. Same admin gate TopBar uses for the Users menu. */}
          <CanAccess resource="members" action="list">
            <MetricsCards />
          </CanAccess>
          <PipelineSnapshot singleId={selectedSingleId} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <RecentSuggestions singleId={selectedSingleId} />
            </div>
            <div className="flex flex-col gap-6 lg:col-span-4">
              {/* Story 12.1 (gap D1): account-wide, read-only "Due now"
                  reminders card — first child of this column, above the
                  DashboardStat grid. */}
              <DueRemindersCard />
              {/* F4 fix: DashboardStat is a half-width tile (design-language
                  §5.7); the grid wrapper survives even with a single child so
                  it doesn't stretch to fill the column now that the
                  References tile (RULING 7) is gone. */}
              <div className="grid grid-cols-2 gap-4">
                <DashboardStat
                  label="Shadchanim"
                  value={totalShadchanim}
                  icon={Users}
                  to="/shadchanim"
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
