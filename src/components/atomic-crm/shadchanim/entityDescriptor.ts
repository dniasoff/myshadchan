import type { EntityDescriptor } from "../entity360/entityDescriptor";
import { registerEntityDescriptor } from "../entity360/registry";

/**
 * Story 3.9 stub — written as a file Epic 5 (Story 5.9) will REPLACE
 * wholesale via `registerEntityDescriptor(shadchanimDescriptor, { replace:
 * true })` (contract §4 rules 2 and 5), not as one literal among four in a
 * shared module four Epic 5 stories would hand-edit concurrently.
 *
 * `pendingTabs` carries this entity's FULL canonical tab set (contract §3
 * rule 5): nothing is built yet, and there is no separate stub-exemption
 * list.
 *
 * `shadchanim/index.ts` already registers `show: ShadchanShow`, so this
 * path is today's real route. This is the fact `reminders/reminderEntity.ts`'s
 * retired hand-rolled path builder got wrong — its stale comment claimed
 * shadchanim had no show route and routed reminders to the EDIT page
 * instead; this descriptor (and `RecordLink` consuming it) fixes that live
 * bug.
 */
export const shadchanimDescriptor: EntityDescriptor = {
  name: "shadchanim",
  label: "Shadchanim",
  buildRecordPath: (id) => `/shadchanim/${id}/show`,
  tabs: [],
  pendingTabs: ["overview", "shidduchim", "notes", "tasks", "activity"],
};

registerEntityDescriptor(shadchanimDescriptor);
