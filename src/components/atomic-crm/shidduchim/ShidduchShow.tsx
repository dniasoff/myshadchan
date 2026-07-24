import type { Identifier } from "ra-core";
import { useGetList, useGetOne, useRedirect } from "ra-core";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { EmptyState } from "../misc/EmptyState";
import type { Redt, Shadchan, ShidduchSchool, ShidduchSummary } from "../types";
import { ShidduchReferencesSection } from "../references/ShidduchReferencesSection";
import { RedtHistorySection } from "./RedtHistorySection";
import { ShidduchCatchSection } from "./ShidduchCatchSection";
import { ShidduchFactsCard } from "./ShidduchFactsCard";
import { ShidduchSchoolsSection } from "./ShidduchSchoolsSection";
import { ShidduchShowHeader } from "./ShidduchShowHeader";
import { ShidduchStateControl } from "./ShidduchStateControl";
import { ShidduchTimeline } from "./ShidduchTimeline";

/**
 * The 360 suggestion view (Screen 18). A routed Dialog (`/shidduchim/:id/show`
 * over the board), not a `Show` — the board stays visible behind the scrim.
 * The dialog surface is a solid `bg-card` (design-language §6.4 rule 4: a
 * dense, scrolling dialog is not glass — glass is chrome/overlay-only, and
 * the board bleeding through would wash out the header below WCAG AA).
 */
export const ShidduchShow = ({
  open,
  id,
}: {
  open: boolean;
  id?: Identifier;
}) => {
  const redirect = useRedirect();
  const handleClose = () => redirect("/shidduchim");
  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      <DialogContent
        className="top-1/20 max-h-9/10 translate-y-0 overflow-y-auto border-border
          bg-card shadow-lg lg:max-w-2xl"
      >
        {id ? (
          <ShidduchShowContent id={id} />
        ) : (
          <ShidduchShowSkeleton />
        )}
      </DialogContent>
    </Dialog>
  );
};

const ShidduchShowSkeleton = () => (
  <div className="flex flex-col gap-5" aria-busy="true">
    <div className="flex items-start gap-4">
      <Skeleton className="size-14 shrink-0 rounded-2xl" />
      <div className="flex-1 flex flex-col gap-2">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-5 w-1/3" />
      </div>
    </div>
    <Skeleton className="h-32 w-full rounded-2xl" />
    <Skeleton className="h-24 w-full rounded-2xl" />
    <Skeleton className="h-24 w-full rounded-2xl" />
  </div>
);

const ShidduchShowContent = ({ id }: { id: Identifier }) => {
  const { data: shidduch, isPending, error } = useGetOne<ShidduchSummary>(
    "shidduchim",
    { id },
  );
  const { data: redts } = useGetList<Redt>("redts", {
    filter: { shidduchim_id: id },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "redt_date", order: "DESC" },
  });
  const { data: shadchanim } = useGetList<Shadchan>("shadchanim", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "name", order: "ASC" },
  });
  const { data: schools } = useGetList<ShidduchSchool>("shidduch_schools", {
    filter: { shidduchim_id: id },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "id", order: "ASC" },
  });

  if (isPending) return <ShidduchShowSkeleton />;

  if (error || !shidduch) {
    return (
      <EmptyState
        title="This suggestion could not be loaded"
        description="It may have been removed, or you may not have access to it."
      />
    );
  }

  const shadchanName = (shadchanId?: Identifier | null) =>
    shadchanim?.find((s) => s.id === shadchanId)?.name ?? "Unknown shadchan";

  return (
    <div className="flex flex-col gap-5">
      <ShidduchShowHeader
        shidduch={shidduch}
        firstSuggestedByName={
          shidduch.first_suggested_by
            ? shadchanName(shidduch.first_suggested_by)
            : null
        }
      />

      <ShidduchStateControl
        id={id}
        currentState={shidduch.pipeline_state}
        name={shidduch.name_en}
      />

      <ShidduchCatchSection shidduchimId={id} />

      <ShidduchFactsCard shidduch={shidduch} />

      <ShidduchSchoolsSection shidduchimId={id} schools={schools ?? []} />

      <RedtHistorySection
        shidduchimId={id}
        history={redts ?? []}
        shadchanName={shadchanName}
      />

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <ShidduchReferencesSection shidduchimId={id} />
      </div>

      <ShidduchTimeline shidduchimId={id} />
    </div>
  );
};
