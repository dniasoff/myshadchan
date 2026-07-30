import type { EntityDescriptor } from "../entity360/entityDescriptor";
import { registerEntityDescriptor } from "../entity360/registry";
import type { Reference } from "../types";
import {
  ReferenceActions,
  ReferenceActivityTab,
  ReferenceAssistantTab,
  ReferenceConversationsTab,
  ReferenceIdentityHeader,
  ReferenceNotesTab,
  ReferenceShidduchimTab,
  ReferenceTasksTab,
} from "./entityDescriptorRegions";
import { ReferenceOverviewTab } from "./ReferenceOverviewTab";

/**
 * Story 5.10 — replaces the 3.9 stub (`references/entityDescriptor.ts`,
 * deleted in this diff) wholesale via
 * `registerEntityDescriptor(referencesDescriptor, { replace: true })`, per
 * contract §4 rules 2 and 5 and the stub's own doc comment. This is the only
 * registration site for `"references"`, so `{ replace: true }` is
 * uniform-by-convention here (mirrors 5.1/5.8/5.9) rather than a fix for a
 * live throw — `registry.ts`'s guard only fires when a SECOND site for the
 * same name registers without the flag.
 *
 * `buildRecordPath` flips to the bare AD-24 shape. All seven of this
 * entity's canonical tab keys (`entity360/ad24Conformance.ts`'s
 * `CANONICAL_TAB_SETS.references`) move into `tabs`, in canonical order, and
 * `pendingTabs` becomes `[]` in this same diff — `references/index.ts`
 * mounts the matching route shape (AC 4/AC 5) in the same diff too, so a
 * `/references/{id}/{tab}` navigation renders `Entity360`'s tab strip, never
 * `ReferenceEdit`.
 *
 * `browsable: false` (RULING 7) is UNCHANGED from the 3.9 stub — this story
 * migrates the record surface, it does not touch the no-browse decision.
 *
 * `identityHeader`/`actions` are thin adapters, defined in
 * `./entityDescriptorRegions` (a separate module because they are
 * components and this file's export, `referencesDescriptor`, is not —
 * `react-refresh/only-export-components` flags a file mixing the two).
 * `ReferenceHeader` (relocated here from the deleted `ReferenceShow.tsx`)
 * keeps only contact-style facts (name, avatar, conversation-progress
 * meter); `overview` renders the rest (relationship/phone/school/grad_year)
 * through `ReferenceOverviewTab`, so the shell never renders the same fact
 * twice. `Shidduchim` renders through an explicit `tabs` entry over the
 * universal `RelatedRecordsTab` (AC 4), never a hand-rolled `useGetList` —
 * declared explicitly (not via `relationships`) so it lands at its
 * canonical position 3, not appended last by `mergeEntityTabs`.
 */
export const referencesDescriptor: EntityDescriptor<Reference> = {
  name: "references",
  label: "References",
  browsable: false,
  buildRecordPath: (id) => `/references/${id}`,
  identityHeader: ReferenceIdentityHeader,
  actions: ReferenceActions,
  tabs: [
    { key: "overview", render: () => <ReferenceOverviewTab /> },
    { key: "conversations", render: () => <ReferenceConversationsTab /> },
    { key: "shidduchim", render: () => <ReferenceShidduchimTab /> },
    { key: "notes", render: () => <ReferenceNotesTab /> },
    {
      key: "tasks",
      // Story 6.2 (AC 10): tasks is one of the tables RLS empties for a
      // single (05_policies.sql) — hide the now-permanently-empty tab
      // rather than leave it as a dead shell (visibleTo is an allow-list,
      // so excluding `single` means naming the other four roles).
      visibleTo: ["parent_admin", "self_manager", "helper", "shadchan"],
      render: () => <ReferenceTasksTab />,
    },
    { key: "activity", render: () => <ReferenceActivityTab /> },
    { key: "assistant", render: () => <ReferenceAssistantTab /> },
  ],
  pendingTabs: [],
};

registerEntityDescriptor(referencesDescriptor, { replace: true });
