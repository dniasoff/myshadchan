import type { EntityDescriptor } from "../entity360/entityDescriptor";
import { registerEntityDescriptor } from "../entity360/registry";
import type { Single } from "../types";
import {
  SingleActions,
  SingleActivityTab,
  SingleFilesTab,
  SingleIdentityHeader,
  SingleNotesTab,
  SinglePhotoTab,
  SingleResumeTab,
  SingleShidduchimTab,
  SingleTasksTab,
} from "./entityDescriptorRegions";
import { SingleOverviewTab } from "./SingleOverviewTab";

/**
 * Story 5.8 — replaces the 3.9 stub (`singles/entityDescriptor.ts`, deleted
 * in this diff) wholesale via
 * `registerEntityDescriptor(singlesDescriptor, { replace: true })`, per
 * contract §4 rules 2 and 5 and the stub's own doc comment. This is the
 * only registration site for `"singles"`, so `{ replace: true }` is
 * uniform-by-convention here (mirrors 5.1/5.9/5.10) rather than a fix for a
 * live throw — `registry.ts`'s guard only fires when a SECOND site for the
 * same name registers without the flag.
 *
 * `buildRecordPath` flips to the bare AD-24 shape (the `encodeURIComponent`
 * form `hasAd24RecordShape` compares against). All eight of this entity's
 * canonical tab keys (`entity360/ad24Conformance.ts`'s
 * `CANONICAL_TAB_SETS.singles`) move into `tabs`, in canonical order, and
 * `pendingTabs` becomes `[]` in this same diff — `singles/index.ts` mounts
 * the matching route shape (AC 4/AC 5) in the same diff too, so a
 * `/singles/{id}/{tab}` navigation renders `Entity360`'s tab strip, never
 * `SingleEdit`.
 *
 * `identityHeader`/`actions` are thin adapters, defined in
 * `./entityDescriptorRegions` (a separate module because they are
 * components and this file's export, `singlesDescriptor`, is not —
 * `react-refresh/only-export-components` flags a file mixing the two).
 * `SingleProfileHeader` (Story 3.1, relocated here from the deleted routed
 * record page — AC 9) keeps its own `{ single: Single }` prop signature
 * unchanged; `SingleIdentityHeader` is the one-line adapter to
 * `ComponentType<{ record: T }>`. `Resume`/`Photo` reuse Story 5.3/5.4's
 * `ResumeUpload`/`ResumeVersionList`/`PhotoTabContent` with a
 * `{ singleId }` subject (AC 3) — no new upload, version-list or reveal
 * component. `Shidduchim` renders through the universal
 * `RelatedRecordsTab` (AC 8), never a hand-rolled `useGetList`.
 */
export const singlesDescriptor: EntityDescriptor<Single> = {
  name: "singles",
  label: "Singles",
  buildRecordPath: (id) => `/singles/${encodeURIComponent(id)}`,
  identityHeader: SingleIdentityHeader,
  actions: SingleActions,
  tabs: [
    { key: "overview", render: () => <SingleOverviewTab /> },
    { key: "resume", render: () => <SingleResumeTab /> },
    { key: "photo", render: () => <SinglePhotoTab /> },
    { key: "files", render: () => <SingleFilesTab /> },
    { key: "shidduchim", render: () => <SingleShidduchimTab /> },
    { key: "notes", render: () => <SingleNotesTab /> },
    {
      key: "tasks",
      // Story 6.2 (AC 10): tasks is one of the tables RLS empties for a
      // single (05_policies.sql) — hide the now-permanently-empty tab
      // rather than leave it as a dead shell (visibleTo is an allow-list,
      // so excluding `single` means naming the other four roles).
      visibleTo: ["parent_admin", "self_manager", "helper", "shadchan"],
      render: () => <SingleTasksTab />,
    },
    { key: "activity", render: () => <SingleActivityTab /> },
  ],
  pendingTabs: [],
};

registerEntityDescriptor(singlesDescriptor, { replace: true });
