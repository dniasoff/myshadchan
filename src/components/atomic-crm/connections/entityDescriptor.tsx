import type { EntityDescriptor } from "../entity360/entityDescriptor";
import { registerEntityDescriptor } from "../entity360/registry";
import type { Connection } from "../types";
import { ConnectionOverviewTab } from "./ConnectionOverviewTab";
import {
  ConnectionActivityTab,
  ConnectionDiscussionsTab,
  ConnectionIdentityHeader,
  ConnectionNotesTab,
  ConnectionRightRail,
  ConnectionStatBand,
  ConnectionTasksTab,
} from "./entityDescriptorRegions";

/**
 * Story 8.5 — the AD-24 descriptor for the `connections` resource. This is
 * the FIRST and only registration site for `"connections"` (no earlier stub
 * to replace, unlike 5.1/5.8/5.9/5.10's `{ replace: true }` migrations —
 * Story 8.1 registered no descriptor for it at all, only a bare custom-route
 * placeholder).
 *
 * All five of this entity's canonical tab keys
 * (`entity360/ad24Conformance.ts`'s `CANONICAL_TAB_SETS.connections`) ship
 * in `tabs`, in canonical order, with an empty `pendingTabs` — this story
 * needs no phased rollout, unlike Epic 5's per-tab migrations.
 *
 * `identityHeader`/`statBand`/`rightRail` are thin adapters, defined in
 * `./entityDescriptorRegions` (a separate module because they are components
 * and this file's export, `connectionsDescriptor`, is not —
 * `react-refresh/only-export-components` flags a file mixing the two).
 *
 * No `actions` region: unlike `shadchanim`/`references`, a connection has no
 * Edit route (it is never a user-authored form — Story 8.2's consent
 * workflow is the only writer) — the two affordances a viewer needs
 * ("Send a redt", "End connection") live in `rightRail` instead (AC-4/AC-5).
 *
 * `overview` renders `ConnectionOverviewTab` — the facts left outside the
 * identity header (proposed-by side, ended-at). `discussions` renders
 * `ConnectionDiscussionsTab`, reusing Epic 7's `ThreadList` unchanged
 * (Task 3). `notes`/`tasks`/`activity` are Epic 3's universal tabs, reached
 * through the arity-zero `{ targetType: "connection", targetId }` adapters
 * in `entityDescriptorRegions.tsx` — no bespoke component, per Ruling 2 and
 * exactly the reuse Story 3.14/R1 lifted `tasks`/`interactions` out of
 * `enforce_household_scope()` for in the first place.
 */
export const connectionsDescriptor: EntityDescriptor<Connection> = {
  name: "connections",
  label: "Connections",
  buildRecordPath: (id) => `/connections/${id}`,
  identityHeader: ConnectionIdentityHeader,
  statBand: ConnectionStatBand,
  rightRail: ConnectionRightRail,
  tabs: [
    { key: "overview", render: () => <ConnectionOverviewTab /> },
    { key: "discussions", render: () => <ConnectionDiscussionsTab /> },
    { key: "notes", render: () => <ConnectionNotesTab /> },
    { key: "tasks", render: () => <ConnectionTasksTab /> },
    { key: "activity", render: () => <ConnectionActivityTab /> },
  ],
  pendingTabs: [],
};

registerEntityDescriptor(connectionsDescriptor);
