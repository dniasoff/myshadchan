import { Kanban, LayoutGrid, LayoutList } from "lucide-react";
import { useStore, useTranslate } from "ra-core";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";

import { useEntityListStatus } from "../misc/useEntityListStatus";
import {
  PipelineListSkeleton,
  ShidduchimPipelineList,
} from "./ShidduchimPipelineList";
import { ShidduchimListContent } from "./ShidduchimListContent";

export type ShidduchimPageView = "board" | "list" | "cards";

const VIEW_OPTIONS: {
  value: ShidduchimPageView;
  Icon: LucideIcon;
  labelKey: string;
  labelDefault: string;
}[] = [
  {
    value: "board",
    Icon: Kanban,
    labelKey: "crm.shidduchim.pageView.board",
    labelDefault: "Board view",
  },
  {
    value: "list",
    Icon: LayoutList,
    labelKey: "crm.shidduchim.pageView.list",
    labelDefault: "List view",
  },
  {
    value: "cards",
    Icon: LayoutGrid,
    labelKey: "crm.shidduchim.pageView.cards",
    labelDefault: "Cards view",
  },
];

/**
 * AC-1/AC-2/AC-5/AC-6: the one three-position control (Board · List ·
 * Cards), keyed to the store — never the URL (see the story's Dev Notes,
 * "Why the view choice cannot live in the URL"). The single `useIsMobile()`
 * call under `shidduchim/` lives here and its only consumer is the
 * `useStore` default below (AC-2). The single `useEntityListStatus()` call
 * here renders the shared loading/error(+retry) states — no position below
 * renders its own (AC-5). Board, List and Cards all read the SAME
 * `useListContext()` data from the SAME enclosing `<List>` in
 * `ShidduchimList.tsx` (AC-6): switching position never re-queries.
 */
export const ShidduchimViewSwitch = () => {
  const translate = useTranslate();
  const status = useEntityListStatus();
  const isMobile = useIsMobile(); // AC-2: the ONLY call under shidduchim/
  const [stored, setStored] = useStore<ShidduchimPageView>(
    "shidduchim.pageView",
  );
  const view = stored ?? (isMobile ? "list" : "board");

  if (status.status === "loading") {
    return <PipelineListSkeleton />;
  }

  if (status.status === "error") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          {translate("crm.entity_list.error", {
            _: "Something went wrong loading this list.",
          })}
        </p>
        <Button type="button" variant="outline" onClick={status.refetch}>
          {translate("crm.entity_list.retry", { _: "Try again" })}
        </Button>
      </div>
    );
  }

  return (
    // Task 8: the tour's "pipeline-board" anchor points at this root — the
    // one element that exists no matter which of the three positions
    // (board/list/cards) happens to be active, unlike the old anchor on the
    // Board's own inner div.
    <div data-tour="pipeline-board" className="flex flex-col gap-4">
      <div
        role="group"
        aria-label={translate("crm.shidduchim.pageView.label", {
          _: "Pipeline view",
        })}
        className="inline-flex shrink-0 items-center gap-0.5 self-end rounded-lg border p-0.5"
      >
        {VIEW_OPTIONS.map(({ value, Icon, labelKey, labelDefault }) => {
          const label = translate(labelKey, { _: labelDefault });
          return (
            <Button
              key={value}
              type="button"
              size="icon"
              variant={view === value ? "secondary" : "ghost"}
              aria-pressed={view === value}
              aria-label={label}
              onClick={() => setStored(value)}
            >
              <Icon className="size-4" aria-hidden="true" />
            </Button>
          );
        })}
      </div>

      {view === "board" ? (
        <ShidduchimListContent />
      ) : (
        <ShidduchimPipelineList view={view} />
      )}
    </div>
  );
};
