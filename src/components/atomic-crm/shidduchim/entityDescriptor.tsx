import type { EntityDescriptor } from "../entity360/entityDescriptor";
import { registerEntityDescriptor } from "../entity360/registry";
import { ShidduchOverviewTab } from "./ShidduchOverviewTab";
import {
  ShidduchActions,
  ShidduchActivityTab,
  ShidduchDiligenceTab,
  ShidduchIdentityHeader,
  ShidduchNotesTab,
  ShidduchTasksTab,
} from "./entityDescriptorRegions";
import type { ShidduchSummary } from "../types";

/**
 * Story 5.1 — replaces the 3.9 stub wholesale
 * (`registerEntityDescriptor(shidduchimDescriptor, { replace: true })`,
 * contract §4 rules 2 and 5): the routed `<Dialog>` (`ShidduchShow.tsx`,
 * deleted by this story) is gone, `buildRecordPath` returns the bare AD-24
 * shape, and the entity ships a deliberately partial `tabs` array —
 * `overview, diligence, notes, tasks, activity` — with the remaining five
 * canonical keys (`resume, photo, medical, files, external-links`) declared
 * in `pendingTabs` rather than built as empty placeholders (contract §3
 * rule 5, clauses a-d; this story is the sanctioned partial case named
 * verbatim there). Stories 5.3-5.6 each move one key out of `pendingTabs`
 * and into `tabs`, in canonical position, in the same diff that builds it.
 *
 * `identityHeader` / `actions` / the four tab `render` functions are thin
 * adapters, defined in `./entityDescriptorRegions` (a separate module
 * because they are components and this file's export,
 * `shidduchimDescriptor`, is not — `react-refresh/only-export-components`
 * flags a file mixing the two). Neither `ShidduchShowHeader`'s nor
 * `ShidduchStateControl`'s own prop signature changes (AC 6): both are
 * relocated, not rewritten.
 */
export const shidduchimDescriptor: EntityDescriptor<ShidduchSummary> = {
  name: "shidduchim",
  label: "Shidduchim",
  buildRecordPath: (id) => `/shidduchim/${id}`,
  identityHeader: ShidduchIdentityHeader,
  actions: ShidduchActions,
  tabs: [
    { key: "overview", render: () => <ShidduchOverviewTab /> },
    { key: "diligence", render: () => <ShidduchDiligenceTab /> },
    { key: "notes", render: () => <ShidduchNotesTab /> },
    { key: "tasks", render: () => <ShidduchTasksTab /> },
    { key: "activity", render: () => <ShidduchActivityTab /> },
  ],
  pendingTabs: ["resume", "photo", "medical", "files", "external-links"],
};

registerEntityDescriptor(shidduchimDescriptor, { replace: true });
