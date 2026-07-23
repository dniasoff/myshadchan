import { ChevronRight } from "lucide-react";
import { useTranslate } from "ra-core";
import { Link } from "react-router";

import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";

import { ChangelogPage } from "../misc/ChangelogPage";
import { SectionLabel } from "./SectionLabel";

/** Links out to the changelog — shared by the mobile and desktop Settings surfaces. */
export const AboutSection = () => {
  const translate = useTranslate();

  return (
    <div>
      <SectionLabel>{translate("crm.settings.about")}</SectionLabel>
      <ItemGroup className="rounded-lg border overflow-hidden">
        <Item asChild size="sm" className="cursor-pointer">
          <Link to={ChangelogPage.path}>
            <ItemContent>
              <ItemTitle className="font-normal">
                {translate("crm.changelog.title")}
              </ItemTitle>
            </ItemContent>
            <ItemActions>
              <ChevronRight className="size-4 text-muted-foreground" />
            </ItemActions>
          </Link>
        </Item>
      </ItemGroup>
    </div>
  );
};
