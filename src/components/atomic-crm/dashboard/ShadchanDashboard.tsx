import { useTranslate } from "ra-core";

import { EmptyState } from "../misc/EmptyState";

/**
 * Story 8.1 (AC-5): the shadchanus-context landing screen — rendered instead
 * of the household `Dashboard`/`MobileDashboard` (which query household
 * resources like `singles` and would show nonsensical copy such as
 * "0 singles" for an account that can never hold one, AD-2). Which of the
 * two renders at `/` is decided by `root/CRM.tsx`'s dashboard-route picker,
 * not by this component.
 *
 * Honest about having nothing yet: no `connections` query, no Epic-7
 * `threads` query — that data belongs to Story 8.5's real Connections
 * list/360. This screen never fetches anything, so its empty state is the
 * only state (AC-6: no bespoke layout code — it reuses `misc/EmptyState.tsx`
 * exactly the way `RemindersPage.tsx` reuses the same header/eyebrow shape).
 */
export const ShadchanDashboard = () => {
  const translate = useTranslate();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {translate("crm.shadchanus_context.eyebrow", { _: "Shadchanus" })}
        </p>
        <h1 className="font-display text-[2rem] font-bold leading-[1.1] tracking-[-0.02em]">
          {translate("crm.shadchan_dashboard.title", {
            _: "Your shadchanus workspace",
          })}
        </h1>
      </div>
      <EmptyState
        title={translate("crm.shadchan_dashboard.empty_title", {
          _: "Nothing here yet",
        })}
        description={translate("crm.shadchan_dashboard.empty_description", {
          _: "Once you connect with a family, their conversations will appear here.",
        })}
      />
    </div>
  );
};
