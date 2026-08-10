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
import { SinglePreferencesTab } from "./SinglePreferencesTab";
import { SinglePrivateNotesTab } from "./SinglePrivateNotesTab";

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
 *
 * Story 6.3 (AC 9) adds `visibleTo: ["parent_admin", "self_manager",
 * "helper", "shadchan"]` — the same allow-list Story 6.2 (AC 10) put on
 * `tasks` — to `files` and `notes`: `entity_files` and `interactions` both
 * deny the `single` role at the database (AC 1/AC 2), so a single's own
 * 360 would otherwise show a permanently-empty Files/Notes tab. `activity`
 * gets it too (same `interactions` table). `overview`, `resume`, `photo`
 * and `shidduchim` stay unrestricted — they are the dignity floor.
 */
export const singlesDescriptor: EntityDescriptor<Single> = {
  name: "singles",
  label: "Singles",
  buildRecordPath: (id) => `/singles/${encodeURIComponent(id)}`,
  identityHeader: SingleIdentityHeader,
  actions: SingleActions,
  tabs: [
    { key: "overview", render: () => <SingleOverviewTab /> },
    // Story 16.1 / FR67: Preferences is the single's primary surface —
    // intentionally no visibleTo so it stays on the dignity floor with
    // Overview, Resume, Photo, Shidduchim. RLS governs row access.
    { key: "preferences", render: () => <SinglePreferencesTab /> },
    // Story 16.3 / FR69, PRV-4: her own private notes. Like Preferences,
    // intentionally NO visibleTo — an allow-list here would hide the tab
    // from the single herself, the exact inverse of the story. RLS governs
    // which rows anyone sees.
    { key: "private-notes", render: () => <SinglePrivateNotesTab /> },
    { key: "resume", render: () => <SingleResumeTab /> },
    { key: "photo", render: () => <SinglePhotoTab /> },
    {
      key: "files",
      // Story 6.3 (AC 9): entity_files denies `single` at the database.
      visibleTo: ["parent_admin", "self_manager", "helper", "shadchan"],
      render: () => <SingleFilesTab />,
    },
    { key: "shidduchim", render: () => <SingleShidduchimTab /> },
    {
      key: "notes",
      // Story 6.3 (AC 9): interactions denies `single` by default at the
      // database (AC 2).
      visibleTo: ["parent_admin", "self_manager", "helper", "shadchan"],
      render: () => <SingleNotesTab />,
    },
    {
      key: "tasks",
      // Story 6.2 (AC 10): tasks is one of the tables RLS empties for a
      // single (05_policies.sql) — hide the now-permanently-empty tab
      // rather than leave it as a dead shell (visibleTo is an allow-list,
      // so excluding `single` means naming the other four roles).
      visibleTo: ["parent_admin", "self_manager", "helper", "shadchan"],
      render: () => <SingleTasksTab />,
    },
    {
      key: "activity",
      // Story 6.3 (AC 9): interactions denies `single` by default at the
      // database (AC 2) — the activity timeline reads through the same
      // table as notes.
      visibleTo: ["parent_admin", "self_manager", "helper", "shadchan"],
      render: () => <SingleActivityTab />,
    },
  ],
  pendingTabs: [],
};

registerEntityDescriptor(singlesDescriptor, { replace: true });
