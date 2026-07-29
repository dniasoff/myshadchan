import { LayoutGrid, LayoutList } from "lucide-react";
import { useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import type { EntityListViewMode } from "./useEntityListViewMode";

export interface EntityListViewToggleProps {
  mode: EntityListViewMode;
  onChange: (mode: EntityListViewMode) => void;
}

/**
 * AD-24/UX-DR7's one shared List/Cards control (AC 2): a controlled
 * two-button segmented toggle. It never reads or writes the persisted mode
 * itself — the parent (`EntityList`, via `useEntityListViewMode`) owns that
 * and passes `mode`/`onChange` down — so this component unit-tests with
 * nothing beyond a translate context, no store required.
 */
export const EntityListViewToggle = ({
  mode,
  onChange,
}: EntityListViewToggleProps) => {
  const translate = useTranslate();
  const listLabel = translate("crm.entity_list.view_list", {
    _: "List view",
  });
  const cardsLabel = translate("crm.entity_list.view_cards", {
    _: "Cards view",
  });

  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5">
      <Button
        type="button"
        size="icon"
        variant={mode === "list" ? "secondary" : "ghost"}
        aria-pressed={mode === "list"}
        aria-label={listLabel}
        onClick={() => onChange("list")}
      >
        <LayoutList className="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant={mode === "cards" ? "secondary" : "ghost"}
        aria-pressed={mode === "cards"}
        aria-label={cardsLabel}
        onClick={() => onChange("cards")}
      >
        <LayoutGrid className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
};
