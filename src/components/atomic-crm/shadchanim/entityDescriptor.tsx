import type { EntityDescriptor } from "../entity360/entityDescriptor";
import { registerEntityDescriptor } from "../entity360/registry";
import type { Shadchan } from "../types";
import {
  ShadchanActions,
  ShadchanActivityTab,
  ShadchanIdentityHeader,
  ShadchanNotesTab,
  ShadchanShidduchimTab,
  ShadchanStatBand,
  ShadchanTasksTab,
} from "./entityDescriptorRegions";
import { ShadchanOverviewTab } from "./ShadchanOverviewTab";

/**
 * Story 5.9 — replaces the 3.9 stub (`shadchanim/entityDescriptor.ts`,
 * deleted in this diff) wholesale via
 * `registerEntityDescriptor(shadchanimDescriptor, { replace: true })`, per
 * contract §4 rules 2 and 5 and the stub's own doc comment. This is the only
 * registration site for `"shadchanim"`.
 *
 * `buildRecordPath` flips to the bare AD-24 shape. All five of this entity's
 * canonical tab keys (`entity360/ad24Conformance.ts`'s
 * `CANONICAL_TAB_SETS.shadchanim`) move into `tabs`, in canonical order, and
 * `pendingTabs` becomes `[]` in this same diff — `shadchanim/index.ts`
 * mounts the matching route shape (AC 4/AC 5) in the same diff too, so a
 * `/shadchanim/{id}/{tab}` navigation renders `Entity360`'s tab strip, never
 * `ShadchanEdit`.
 *
 * `identityHeader`/`statBand`/`actions` are thin adapters, defined in
 * `./entityDescriptorRegions` (a separate module because they are components
 * and this file's export, `shadchanimDescriptor`, is not —
 * `react-refresh/only-export-components` flags a file mixing the two).
 * `ShadchanHeader`/`ShadchanStatsRow` keep their own pre-existing prop
 * signatures unchanged (`{ shadchan }` / `{ shadchanId }`) — they are
 * relocated into the shell, not rewritten.
 *
 * `overview` renders `ShadchanOverviewTab` (RULING 8, option B): the one
 * `Shadchan` field left outside the header (`name_he`) plus two facts
 * derived from the widened `shadchan_stats` view (Task 2b) — last redt and
 * how many singles this shadchan is currently working on.
 *
 * `shidduchim` renders `ShadchanSuggestions` (unchanged) as an explicit
 * `tabs` entry — deliberately NOT the generic `relationships` ->
 * `RelatedRecordsTab` mechanism 5.8/5.10 use for the same key. This is a
 * recorded divergence, not drift: `ShadchanSuggestions.tsx` already carries
 * a 5-row preview with a "Show all N" toggle and a `StateChip` column
 * `RelatedRecordsTab` does not, was hardened by the mobile-redesign wave S,
 * and already satisfies the requirement — re-deriving it through
 * `RelatedRecordsTab` would be a behaviour regression, not a cleanup. Do not
 * generalise from this to a fourth entity.
 *
 * `notes`/`tasks`/`activity` are Epic 3's universal tabs, reached through
 * the arity-zero `{ targetType: "shadchan", targetId }` adapters above.
 */
export const shadchanimDescriptor: EntityDescriptor<Shadchan> = {
  name: "shadchanim",
  label: "Shadchanim",
  buildRecordPath: (id) => `/shadchanim/${id}`,
  identityHeader: ShadchanIdentityHeader,
  actions: ShadchanActions,
  statBand: ShadchanStatBand,
  tabs: [
    { key: "overview", render: () => <ShadchanOverviewTab /> },
    { key: "shidduchim", render: () => <ShadchanShidduchimTab /> },
    { key: "notes", render: () => <ShadchanNotesTab /> },
    {
      key: "tasks",
      // Story 6.2 (AC 10): tasks is one of the tables RLS empties for a
      // single (05_policies.sql) — hide the now-permanently-empty tab
      // rather than leave it as a dead shell (visibleTo is an allow-list,
      // so excluding `single` means naming the other four roles).
      visibleTo: ["parent_admin", "self_manager", "helper", "shadchan"],
      render: () => <ShadchanTasksTab />,
    },
    { key: "activity", render: () => <ShadchanActivityTab /> },
  ],
  pendingTabs: [],
};

registerEntityDescriptor(shadchanimDescriptor, { replace: true });
