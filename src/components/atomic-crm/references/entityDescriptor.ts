import type { EntityDescriptor } from "../entity360/entityDescriptor";
import { registerEntityDescriptor } from "../entity360/registry";

/**
 * Story 3.9 stub — written as a file Epic 5 (Story 5.10) will REPLACE
 * wholesale via `registerEntityDescriptor(referencesDescriptor, { replace:
 * true })` (contract §4 rules 2 and 5), not as one literal among four in a
 * shared module four Epic 5 stories would hand-edit concurrently.
 *
 * `pendingTabs` carries this entity's FULL canonical tab set (contract §3
 * rule 5): nothing is built yet, and there is no separate stub-exemption
 * list.
 *
 * `references/index.ts` already registers `show: ReferenceShow`, so this
 * path is today's real route.
 */
export const referencesDescriptor: EntityDescriptor = {
  name: "references",
  label: "References",
  buildRecordPath: (id) => `/references/${id}/show`,
  tabs: [],
  pendingTabs: [
    "overview",
    "conversations",
    "shidduchim",
    "notes",
    "tasks",
    "activity",
    "assistant",
  ],
};

registerEntityDescriptor(referencesDescriptor);
