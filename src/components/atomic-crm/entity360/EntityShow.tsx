import type { ReactElement } from "react";
import { useRecordContext, useResourceContext } from "ra-core";

import { DefaultIdentityHeader } from "./DefaultIdentityHeader";
import { Entity360 } from "./Entity360";
import { Entity360TabPanel, Entity360TabStrip } from "./Entity360Tabs";
import { mergeEntityTabs } from "./mergeEntityTabs";
import { requireEntityDescriptor } from "./registry";
import { RolePending } from "./RolePending";
import { useViewerRole } from "./useViewerRole";
import { hasVisibility } from "./visibility";

/**
 * AD-24's generic 360 renderer (Epic 3 API contract §4 / §5). Reads
 * `resource` and `record` from context only — no props, and no "or"
 * between the two mechanisms — looks the descriptor up with
 * `requireEntityDescriptor` (absence here is a bug, never a degrade case:
 * `.claude/rules/coding-style.md#Error-handling`), and composes exactly
 * `Entity360`'s seven regions from the declaration. `actions` is never an
 * eighth region: it renders inside `identityHeader`, immediately after the
 * header content, whether that content is the descriptor's own
 * `identityHeader` component or the default avatar/title/meta composition.
 *
 * **`tabBar` and `children` are two separate regions, filled from two
 * separate components — `Entity360TabStrip` and `Entity360TabPanel` — not
 * one `<Entity360Tabs/>` call.** `Entity360`'s `children` region shares the
 * content/rail row with `rightRail` (contract §1 rule 5: the rail sits
 * beside the tab content, not beside the tab strip); `tabBar` renders full
 * width, above that row. A single component instance can only be placed at
 * one position in the tree, so a merged `Entity360Tabs` handed to `tabBar`
 * alone put the whole tab UI — strip AND panel — inside the `tabBar`
 * region, leaving `children` permanently empty: `rightRail` then had
 * nothing to sit beside and rendered alone, below the tab UI, instead of
 * beside its content (defect found in Epic 3 part 1's verification gate).
 * `Entity360Tabs` itself still exists, unchanged, for a caller that wants
 * both pieces in one region.
 *
 * Fetches nothing beyond the record `ShowBase` already supplies (this
 * component always mounts inside it — see `RecordRoute.tsx`); stat- and
 * rail-data loading is the descriptor module's own job. This file is
 * structurally generic: every import below stays inside this directory, and
 * nothing in it names a specific resource — a `?raw` guard proves both
 * halves of that boundary.
 *
 * **Story 3.4 — permission-aware rendering.** `descriptor.tabs` and
 * `descriptor.relationships` are merged FIRST (`mergeEntityTabs`, unchanged
 * — an explicit tab still wins its key's slot over a same-keyed
 * relationship regardless of visibility), and the filter —
 * `hasVisibility(tab.visibleTo, role)` — runs on that merged array, before
 * it ever reaches `Entity360TabStrip`/`Entity360TabPanel`. Filtering the
 * merged array, not `descriptor.tabs` before the merge, is what a denied
 * explicit tab needs: pre-filtering would drop it from `explicitKeys`
 * inside `mergeEntityTabs`, letting a same-keyed relationship's tab (which
 * carries no `visibleTo` of its own — this story's Dev Notes, "Known gap,
 * recorded" — so it is unrestricted) fall through and render in its place.
 * Either way, a denied tab's `render` is never called and its label never
 * enters the DOM (AC 5). While `useViewerRole().isPending` is true, the
 * identity header and stat
 * band still render normally, but `RolePending` — a single i18n-backed
 * region — replaces BOTH the tab bar and the tab content; `Entity360Tabs`
 * is not mounted at all in that window, so 3.2's unknown-tab fallback
 * cannot run and a deep link to a restricted tab is held in place rather
 * than rewritten before the role resolves (AC 6a). An `undefined` role
 * (resolved, no active membership) fails closed the same way an
 * insufficient one does: `hasVisibility` returns `false` for every
 * restricted tab, and 3.2's own unknown-tab fallback — unmodified — is what
 * lands the viewer on the first tab still visible to them.
 */
export function EntityShow(): ReactElement | null {
  const resource = useResourceContext();
  const record = useRecordContext();
  const { role, isPending: isRolePending } = useViewerRole();

  if (!resource) {
    throw new Error(
      "EntityShow must be rendered within a ResourceContextProvider",
    );
  }

  const descriptor = requireEntityDescriptor(resource);

  // `ShowBase` (contract §5 rule 1) supplies `loading`/`error` elements of
  // its own for the pending-fetch and fetch-failed windows, so a defined
  // `record` is the normal case by the time this component renders. Render
  // nothing rather than crash on a missing field in the rare case it does
  // not.
  if (!record) {
    return null;
  }

  const {
    identityHeader: IdentityHeader,
    statBand: StatBand,
    alertSlot: AlertSlot,
    rightRail: RightRail,
    actions: Actions,
  } = descriptor;

  const identityHeader = (
    <>
      {IdentityHeader ? (
        <IdentityHeader record={record} />
      ) : (
        <DefaultIdentityHeader
          record={record}
          avatar={descriptor.avatar}
          title={descriptor.title}
          meta={descriptor.meta}
        />
      )}
      {Actions ? <Actions record={record} /> : null}
    </>
  );
  const statBand = StatBand ? <StatBand record={record} /> : undefined;
  const alertSlot = AlertSlot ? <AlertSlot record={record} /> : undefined;
  const rightRail = RightRail ? <RightRail record={record} /> : undefined;

  // AC 6(a) — a pending role never navigates: `Entity360Tabs` is not
  // mounted, so 3.2's unknown-tab fallback (which lives inside it) has
  // nothing to run from. `rightRail` is deliberately withheld here, not
  // passed through: `Entity360`'s content row renders the rail alone
  // whenever `children` is absent (rule 2's "an absent region renders
  // nothing" only omits the WRAPPER, not the row itself once the rail makes
  // it non-empty) — the exact rail-renders-alone shape Epic 3 part-1's gate
  // already fixed once, here reproduced transiently for the pending
  // window. Deferring the whole content row until the role settles avoids
  // reintroducing that layout shift.
  if (isRolePending) {
    return (
      <Entity360
        identityHeader={identityHeader}
        statBand={statBand}
        alertSlot={alertSlot}
        tabBar={<RolePending />}
      />
    );
  }

  const tabs = mergeEntityTabs(
    descriptor.tabs,
    descriptor.relationships,
  ).filter((tab) => hasVisibility(tab.visibleTo, role));
  const hasTabs = tabs.length > 0;

  return (
    <Entity360
      identityHeader={identityHeader}
      statBand={statBand}
      alertSlot={alertSlot}
      tabBar={hasTabs ? <Entity360TabStrip tabs={tabs} /> : undefined}
      rightRail={rightRail}
    >
      {hasTabs ? <Entity360TabPanel tabs={tabs} /> : undefined}
    </Entity360>
  );
}
