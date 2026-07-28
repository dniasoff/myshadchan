import type { ReactElement } from "react";
import { useRecordContext, useResourceContext } from "ra-core";

import { DefaultIdentityHeader } from "./DefaultIdentityHeader";
import { Entity360 } from "./Entity360";
import { Entity360Tabs } from "./Entity360Tabs";
import { mergeEntityTabs } from "./mergeEntityTabs";
import { requireEntityDescriptor } from "./registry";

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
 * Fetches nothing beyond the record `ShowBase` already supplies (this
 * component always mounts inside it — see `RecordRoute.tsx`); stat- and
 * rail-data loading is the descriptor module's own job. This file is
 * structurally generic: every import below stays inside this directory, and
 * nothing in it names a specific resource — a `?raw` guard proves both
 * halves of that boundary.
 */
export function EntityShow(): ReactElement | null {
  const resource = useResourceContext();
  const record = useRecordContext();

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

  const tabs = mergeEntityTabs(descriptor.tabs, descriptor.relationships);

  return (
    <Entity360
      identityHeader={
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
      }
      statBand={StatBand ? <StatBand record={record} /> : undefined}
      alertSlot={AlertSlot ? <AlertSlot record={record} /> : undefined}
      tabBar={tabs.length > 0 ? <Entity360Tabs tabs={tabs} /> : undefined}
      rightRail={RightRail ? <RightRail record={record} /> : undefined}
    />
  );
}
