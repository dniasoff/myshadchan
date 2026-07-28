import type { EntityDescriptor } from "../entity360/entityDescriptor";
import { registerEntityDescriptor } from "../entity360/registry";

/**
 * Story 3.9 stub — written as a file Epic 5 (Story 5.8) will REPLACE
 * wholesale via `registerEntityDescriptor(singlesDescriptor, { replace:
 * true })` (contract §4 rules 2 and 5), not as one literal among four in a
 * shared module four Epic 5 stories would hand-edit concurrently.
 *
 * `pendingTabs` carries this entity's FULL canonical tab set (contract §3
 * rule 5): nothing is built yet, and there is no separate stub-exemption
 * list.
 *
 * `singles/index.ts` already registers `show: SingleShow`
 * (`SingleShow.tsx`), so — unlike `shidduchim` — this path is both today's
 * real route AND the eventual AD-24 shape once `/show` is dropped.
 */
export const singlesDescriptor: EntityDescriptor = {
  name: "singles",
  label: "Singles",
  buildRecordPath: (id) => `/singles/${id}/show`,
  tabs: [],
  pendingTabs: [
    "overview",
    "resume",
    "photo",
    "files",
    "shidduchim",
    "notes",
    "tasks",
    "activity",
  ],
};

registerEntityDescriptor(singlesDescriptor);
