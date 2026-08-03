import type { ReactElement } from "react";
import { useGetList, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

import { ConsentToRepublishButton } from "../listings/ConsentToRepublishButton";
import { PublishSingleListingSection } from "../listings/PublishSingleListingSection";
import { WithdrawSingleListingButton } from "../listings/WithdrawSingleListingButton";
import { pickActiveContext } from "../providers/commons/roleAuthority";
import { ShareSingleDialog } from "../sharing/ShareSingleDialog";
import { useCurrentMemberId } from "../threads/useCurrentMemberId";
import { useMyContexts } from "../root/useMyContexts";
import { useSingleListingShapeHint } from "../root/singleListingShapeHint";
import type { Listing, Single } from "../types";
import { SectionLabel } from "./SectionLabel";

/** Mirrors `singles/SingleLoginInvite.tsx`'s own display-name fallback —
 * duplicated rather than imported to keep that component's own directory
 * (scanned by `misc/recordSurfaceDialogs.guard.test.ts`) untouched by this
 * settings-only surface. */
const singleDisplayName = (single: Single): string =>
  [single.first_name_en, single.last_name_en].filter(Boolean).join(" ") ||
  `Single #${single.id}`;

const GET_SINGLES_PARAMS = {
  pagination: { page: 1, perPage: 100 },
  sort: { field: "first_name_en" as const, order: "ASC" as const },
};

/** Mirrors a settled row's exact structure (`Item size="sm"` + a real
 * `Button` of the same variant/size) so its height can never differ from
 * the row it stands in for — the same technique `ProfileSection.tsx`'s own
 * `ProfileFieldRowSkeleton` uses. The action is always drawn as a button
 * (never omitted) because a `parent_admin`/`self_manager` hint — the only
 * case this renders for — always has one; a viewer who won't get one
 * settles into the real, action-less row a beat later, which is a much
 * smaller shift than the row's own existence would have been.
 */
const SingleListingRowSkeleton = (): ReactElement => (
  <Item size="sm">
    <ItemContent>
      <Skeleton className="h-4 w-24" />
    </ItemContent>
    <ItemActions className="gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        tabIndex={-1}
        aria-hidden="true"
      >
        <span className="invisible">Publish</span>
      </Button>
    </ItemActions>
  </Item>
);

/**
 * Stands in for the settled card while `useMyContexts()` / `useGetList`
 * are in flight, sized from `hint` (the last settled shape) rather than a
 * fixed guess — `rowCount` rows for a household that had some, the same
 * empty-state copy for one that had none. Shares the settled card's own
 * `SectionLabel` + border + description markup verbatim (not a shared
 * wrapper component — `ProfileSection.tsx` keeps its own skeleton's markup
 * literal for the same reason: the two are meant to read as identical, not
 * merely similar, and a shared wrapper would be one more place a future
 * edit could apply to only one of them).
 */
const SingleListingSectionSkeleton = ({
  rowCount,
}: {
  rowCount: number;
}): ReactElement => {
  const translate = useTranslate();

  return (
    <div>
      <SectionLabel>
        {translate("crm.settings.single_listing.title", {
          _: "Single listings",
        })}
      </SectionLabel>
      <div className="rounded-lg border p-4" aria-busy="true">
        <p className="mb-3 px-1 text-sm text-muted-foreground">
          {translate("crm.settings.single_listing.description", {
            _: "Publish a narrow, opt-in profile so shadchanim can find them.",
          })}
        </p>

        {rowCount === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">
            {translate("crm.settings.single_listing.empty", {
              _: "No singles in this household yet.",
            })}
          </p>
        ) : (
          <ItemGroup className="overflow-hidden rounded-lg border">
            {Array.from({ length: rowCount }, (_, index) => (
              <div key={index}>
                {index > 0 ? <ItemSeparator /> : null}
                <SingleListingRowSkeleton />
              </div>
            ))}
          </ItemGroup>
        )}
      </div>
    </div>
  );
};

/**
 * Story 9.2 — the Settings wiring for publishing a single's listing
 * (FR103): lists every single in the household with a Publish / Manage
 * listing action per row. Renders nothing outside a `household` active
 * context (mirrors `ShadchanListingSection.tsx`'s own kind gate — a
 * shadchanus account has no singles of its own to list).
 *
 * The per-row action is gated to exactly who FR103 lets act — "Who may
 * publish" in the story's own Dev Notes: `parent_admin` (any single in the
 * household) or `self_manager` (only the single record that is themselves,
 * matched by `singles.member_id` against the caller's own
 * `account_members.id`, `useCurrentMemberId()`). A `helper` or a plain
 * `single` sees the roster but no action on any row. This is UX only —
 * Task 1's two new RLS policies are the real boundary either way.
 *
 * CLS fix (Epic 9 layout-shift regression): this used to return `null`
 * while `useMyContexts()` was in flight and then a fixed 2-row skeleton
 * while `useGetList("singles")` was, popping into a differently-sized
 * block twice on a cold load — measured 0.097 CLS against a 0.01 budget
 * (`e2e/demo-banner-cls.spec.ts`). Both transitions are now gated on the
 * same `isSettled` flag and, while unsettled, sized from
 * `useSingleListingShapeHint()` (`root/singleListingShapeHint.ts` — see
 * its own comment for why the hint has to be warmed from the shell, not
 * from here) instead of a fixed guess. Only a genuinely first-ever visit
 * to the whole app (no hint of any kind yet) still pops in at full size —
 * the same "first load on a device" residual `DemoBanner.tsx` documents.
 */
export const SingleListingSection = (): ReactElement | null => {
  const translate = useTranslate();
  const { data: contexts, isPending: contextsPending } = useMyContexts();
  const activeContext = pickActiveContext(contexts);
  const isHousehold = activeContext?.kind === "household";
  const { data: currentMemberId } = useCurrentMemberId();
  const shapeHint = useSingleListingShapeHint();

  const { data: singles, isPending: singlesPending } = useGetList<Single>(
    "singles",
    GET_SINGLES_PARAMS,
    { enabled: isHousehold },
  );

  const { data: listings } = useGetList<Listing>(
    "listings",
    {
      pagination: { page: 1, perPage: 100 },
      filter: {
        account_id: activeContext?.account_id,
        listing_type: "single",
      },
    },
    { enabled: isHousehold },
  );

  // `singlesPending` stays `true` while the query is `enabled: false` (react
  // query never resolves a disabled query to "not pending"), so it only
  // gates settling for a household — a non-household is settled the moment
  // `contexts` itself resolves, exactly like the pre-fix code's own
  // `!isHousehold` short-circuit.
  const isSettled = !contextsPending && (!isHousehold || !singlesPending);

  if (!isSettled) {
    if (!shapeHint || !shapeHint.isHousehold) return null;
    return <SingleListingSectionSkeleton rowCount={shapeHint.rowCount} />;
  }

  if (!activeContext || !isHousehold) return null;

  const listingBySingleId = new Map<Single["id"], Listing>(
    (listings ?? []).map((listing) => [
      listing.single_id as Single["id"],
      listing,
    ]),
  );

  const canPublish = (single: Single): boolean => {
    if (activeContext.role === "parent_admin") return true;
    if (activeContext.role === "self_manager") {
      return currentMemberId != null && single.member_id === currentMemberId;
    }
    return false;
  };

  return (
    <div>
      <SectionLabel>
        {translate("crm.settings.single_listing.title", {
          _: "Single listings",
        })}
      </SectionLabel>
      <div className="rounded-lg border p-4">
        <p className="mb-3 px-1 text-sm text-muted-foreground">
          {translate("crm.settings.single_listing.description", {
            _: "Publish a narrow, opt-in profile so shadchanim can find them.",
          })}
        </p>

        {!singles || singles.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">
            {translate("crm.settings.single_listing.empty", {
              _: "No singles in this household yet.",
            })}
          </p>
        ) : (
          <ItemGroup className="overflow-hidden rounded-lg border">
            {singles.map((single, index) => {
              const existing = listingBySingleId.get(single.id) ?? null;
              const name = singleDisplayName(single);

              return (
                <div key={single.id}>
                  {index > 0 ? <ItemSeparator /> : null}
                  <Item size="sm">
                    <ItemContent>
                      <ItemTitle className="font-normal">{name}</ItemTitle>
                    </ItemContent>
                    <ItemActions className="gap-2">
                      {/* Story 9.3 (AC-1, AC-4): both self-gate on the
                          viewer's own identity, so they render only on the
                          single's OWN row (self_manager or plain single) —
                          never for a parent_admin/helper viewing someone
                          else's row, regardless of canPublish below. */}
                      <WithdrawSingleListingButton
                        single={single}
                        accountId={activeContext.account_id}
                      />
                      <ConsentToRepublishButton
                        single={single}
                        accountId={activeContext.account_id}
                      />
                      {canPublish(single) ? (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button type="button" variant="outline" size="sm">
                              {existing
                                ? translate(
                                    "crm.settings.single_listing.manage_button",
                                    { _: "Manage listing" },
                                  )
                                : translate(
                                    "crm.settings.single_listing.publish_button",
                                    { _: "Publish" },
                                  )}
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                            <DialogHeader>
                              <DialogTitle>
                                {translate(
                                  "crm.settings.single_listing.dialog_title",
                                  {
                                    name,
                                    _: "Publish a listing for %{name}",
                                  },
                                )}
                              </DialogTitle>
                            </DialogHeader>
                            <PublishSingleListingSection
                              single={single}
                              accountId={activeContext.account_id}
                            />
                          </DialogContent>
                        </Dialog>
                      ) : null}
                      {/* Story 9.5 (Task 6): a SEPARATE surface from the
                          Publish dialog above — sharing is targeted and
                          revocable and can include the resume/photo; a
                          listing is an opt-in public snapshot with no
                          files. Manager-scoped the same way (Dev Notes "Why
                          share links are manager-scoped, not
                          household-scoped"), so reuses canPublish's own
                          authority check rather than a second one. */}
                      {canPublish(single) ? (
                        <ShareSingleDialog single={single} />
                      ) : null}
                    </ItemActions>
                  </Item>
                </div>
              );
            })}
          </ItemGroup>
        )}
      </div>
    </div>
  );
};
