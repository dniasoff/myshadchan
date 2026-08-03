import { useTranslate } from "ra-core";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import type { Single } from "../types";
import { CreateShareLinkDialog } from "./CreateShareLinkDialog";
import { ShareLinkList } from "./ShareLinkList";

const singleDisplayName = (single: Single): string =>
  [single.first_name_en, single.last_name_en].filter(Boolean).join(" ") ||
  `Single #${single.id}`;

/**
 * Story 9.5 (Task 6): the Settings entry point for a single's share links —
 * one "Share" action per row in `settings/SingleListingSection.tsx`,
 * opening a dialog that composes the two named components: existing links
 * (`ShareLinkList`) above a "create a new one" form (`CreateShareLinkDialog`).
 * `refreshKey` forces `ShareLinkList` to refetch after a successful create
 * without the two sibling components needing a shared query-cache key —
 * the same "bump a key to force a remount" idiom used for isolated,
 * per-row dialog state elsewhere in this codebase.
 *
 * A SEPARATE surface from `settings/SingleListingSection.tsx`'s own
 * Publish dialog (9.1-9.3) — sharing (targeted, revocable, can include
 * files) and listing (opt-in public discovery snapshot, no files) solve
 * different problems and are never merged into one dialog (9.1 Dev Notes
 * "No photo on a listing"; this story's own Dev Notes "Why share links are
 * manager-scoped, not household-scoped").
 */
export const ShareSingleDialog = ({ single }: { single: Single }) => {
  const translate = useTranslate();
  const [refreshKey, setRefreshKey] = useState(0);
  const name = singleDisplayName(single);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {translate("crm.settings.single_listing.share_button", {
            _: "Share",
          })}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {translate("crm.sharing.share_dialog.title", {
              name,
              _: "Share %{name}'s profile",
            })}
          </DialogTitle>
        </DialogHeader>
        <ShareLinkList key={refreshKey} single={single} />
        <Separator />
        <CreateShareLinkDialog
          single={single}
          onCreated={() => setRefreshKey((key) => key + 1)}
        />
      </DialogContent>
    </Dialog>
  );
};
