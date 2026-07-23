import { BellRing, Clock9 } from "lucide-react";

import { EmptyState } from "../misc/EmptyState";
import { ReminderCard } from "./ReminderCard";
import type { ReminderItem } from "./useReminders";

export interface ReminderListProps {
  isPending: boolean;
  isEmpty: boolean;
  overdue: ReminderItem[];
  upcoming: ReminderItem[];
  onComplete: (item: ReminderItem) => void;
  onSnooze: (item: ReminderItem) => void;
}

const STAGGER_CAP = 8;
const STAGGER_STEP_MS = 40;

const enterDelay = (index: number): number =>
  Math.min(index, STAGGER_CAP) * STAGGER_STEP_MS;

/** A section heading — deliberately no count badge (emotional law #1: relief, not alarm). */
const GroupHeading = ({
  icon: Icon,
  label,
  tone,
}: {
  icon: typeof BellRing;
  label: string;
  tone: "attention" | "neutral";
}) => (
  <div className="mb-2 flex items-center gap-2">
    <Icon
      className={
        tone === "attention"
          ? "size-4 text-attention-foreground"
          : "size-4 text-muted-foreground"
      }
      aria-hidden="true"
    />
    <h2 className="font-display text-base font-semibold">{label}</h2>
  </div>
);

const LoadingSkeleton = () => (
  <div className="flex flex-col gap-3">
    {Array.from({ length: 3 }).map((_, index) => (
      <div key={index} className="h-20 animate-pulse rounded-2xl bg-muted" />
    ))}
  </div>
);

/**
 * Two calm groups — Overdue (honey) and Upcoming — plus loading skeleton and
 * the warm empty state (design-language §5.7/§5.8, foundation dashboard's
 * "you're on top of it" voice).
 */
export const ReminderList = ({
  isPending,
  isEmpty,
  overdue,
  upcoming,
  onComplete,
  onSnooze,
}: ReminderListProps) => {
  if (isPending) return <LoadingSkeleton />;

  if (isEmpty) {
    return (
      <EmptyState
        title="Nothing due — you're on top of it"
        description="This is where overdue reference calls and follow-ups surface, grouped by when they're due, so nothing gets missed."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {overdue.length > 0 ? (
        <section>
          <GroupHeading icon={BellRing} label="Overdue" tone="attention" />
          <ul className="flex flex-col gap-3">
            {overdue.map((item, index) => (
              <ReminderCard
                key={item.task.id}
                item={item}
                onComplete={() => onComplete(item)}
                onSnooze={() => onSnooze(item)}
                enterDelayMs={enterDelay(index)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {upcoming.length > 0 ? (
        <section>
          <GroupHeading icon={Clock9} label="Upcoming" tone="neutral" />
          <ul className="flex flex-col gap-3">
            {upcoming.map((item, index) => (
              <ReminderCard
                key={item.task.id}
                item={item}
                onComplete={() => onComplete(item)}
                onSnooze={() => onSnooze(item)}
                enterDelayMs={enterDelay(overdue.length + index)}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};
