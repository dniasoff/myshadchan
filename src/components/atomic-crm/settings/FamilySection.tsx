import { ChevronRight } from "lucide-react";
import { useGetList, useTranslate } from "ra-core";
import { Link } from "react-router";

import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";

import type { Single } from "../types";
import { SectionLabel } from "./SectionLabel";

/**
 * A quiet summary row linking out to the full Singles resource — grounds
 * the account in "this family" (ticket lane 7's "family/singles" section)
 * without duplicating the Singles list UI here.
 */
export const FamilySection = () => {
  const translate = useTranslate();
  const { total, isPending } = useGetList<Single>("singles", {
    pagination: { page: 1, perPage: 1 },
  });

  return (
    <div>
      <SectionLabel>
        {translate("crm.profile.family.title", { _: "Family" })}
      </SectionLabel>
      <ItemGroup className="rounded-lg border overflow-hidden">
        <Item asChild size="sm" className="cursor-pointer">
          <Link to="/singles">
            <ItemContent>
              <ItemTitle className="font-normal">
                {translate("crm.profile.family.singles", { _: "Singles" })}
              </ItemTitle>
            </ItemContent>
            <ItemActions>
              <span className="tabular-nums text-sm text-muted-foreground">
                {isPending ? "…" : total}
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </ItemActions>
          </Link>
        </Item>
      </ItemGroup>
    </div>
  );
};
