import { useState } from "react";
import type { Identifier } from "ra-core";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type { CrmDataProvider } from "../providers/types";
import type { ShidduchSummary } from "../types";

/**
 * The repair affordance for an unattached reference (RULING 7 §1a).
 *
 * A reference with zero `reference_links` has, by definition, no shidduch to
 * be reached from — which is exactly why it needs somewhere to be attached
 * from. This is that one action, and it is deliberately the ONLY thing the
 * unattached-references index offers besides the record link itself.
 *
 * It writes through `dataProvider.linkReferenceToShidduch`, i.e. the same
 * `link_reference_to_shidduch` RPC match-on-entry and the create path
 * already use — account-checked on both sides and idempotent — so there is
 * exactly one way to attach a reference to a shidduch in the whole app.
 *
 * A `<Popover>`, not a `<Dialog>`: this is a one-tap picker for an action,
 * and `misc/recordSurfaceDialogs.guard.test.ts` scans `references/` for
 * dialog imports (UX-DR3). Nothing here is a record surface, so the right
 * answer is to not be a modal rather than to add an allowlist entry.
 */
export const ReferenceAttachToShidduch = ({
  referenceId,
  referenceName,
}: {
  referenceId: Identifier;
  referenceName?: string | null;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefresh();
  const translate = useTranslate();

  const [isOpen, setIsOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);

  // Enabled only while the picker is open: an unattached-reference row must
  // not fan out a shidduchim query per row just by being rendered.
  const { data: shidduchim, isPending } = useGetList<ShidduchSummary>(
    "shidduchim",
    {
      pagination: { page: 1, perPage: 50 },
      sort: { field: "redt_date", order: "DESC" },
    },
    { enabled: isOpen },
  );

  const handleAttach = async (shidduchimId: Identifier) => {
    setIsWorking(true);
    try {
      await dataProvider.linkReferenceToShidduch({
        reference_id: referenceId,
        shidduchim_id: shidduchimId,
      });
      notify("crm.references.attach.done", {
        type: "success",
        messageArgs: { _: "Attached. This person now belongs to a shidduch." },
      });
      setIsOpen(false);
      refresh();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("ra.notification.http_error"),
        { type: "error" },
      );
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {translate("crm.references.attach.action", {
            _: "Attach to a shidduch",
          })}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="flex max-h-80 w-80 flex-col gap-2 overflow-y-auto">
        <p className="text-sm text-muted-foreground">
          {translate("crm.references.attach.description", {
            name: referenceName || "This person",
            _: "%{name} is not part of any shidduch yet. Pick the one you spoke to them about.",
          })}
        </p>

        {isPending ? (
          <p className="text-sm text-muted-foreground">
            {translate("ra.page.loading")}
          </p>
        ) : (shidduchim ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {translate("crm.references.attach.noShidduchim", {
              _: "There are no shidduchim to attach this person to yet.",
            })}
          </p>
        ) : (
          (shidduchim ?? []).map((shidduch) => (
            <Button
              key={String(shidduch.id)}
              type="button"
              variant="outline"
              className="justify-start"
              disabled={isWorking}
              onClick={() => handleAttach(shidduch.id)}
            >
              <span className="truncate">
                {shidduch.name_en || `#${shidduch.id}`}
                {shidduch.single_first_name_en
                  ? ` · for ${shidduch.single_first_name_en}`
                  : ""}
              </span>
            </Button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
};
