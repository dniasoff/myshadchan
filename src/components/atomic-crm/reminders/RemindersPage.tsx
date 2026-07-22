import { EmptyState } from "../misc/EmptyState";

/**
 * Placeholder for the Reminders nav destination (foundation-plan §2 risk #4).
 * The real catch/overdue engine is a later epic; this avoids dead-linking
 * the nav item and avoids exposing the raw legacy Tasks UI in the meantime.
 */
export const RemindersPage = () => (
  <div className="mx-auto max-w-lg">
    <EmptyState
      title="Reminders are coming soon"
      description="This is where overdue reference calls and follow-ups will surface, so nothing gets missed."
    />
  </div>
);

RemindersPage.path = "/reminders";
