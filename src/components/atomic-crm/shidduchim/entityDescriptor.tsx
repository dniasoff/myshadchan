import type { EntityDescriptor } from "../entity360/entityDescriptor";
import { registerEntityDescriptor } from "../entity360/registry";
import { ResumeTab } from "../resumes/ResumeTab";
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
 * shape, and the entity shipped a deliberately partial `tabs` array —
 * `overview, diligence, notes, tasks, activity` at the time — with the
 * remaining canonical keys declared in `pendingTabs` rather than built as
 * empty placeholders (contract §3 rule 5, clauses a-d; this story is the
 * sanctioned partial case named verbatim there). Stories 5.3-5.6 each move
 * one key out of `pendingTabs` and into `tabs`, in canonical position, in
 * the same diff that builds it — Story 5.3 (`resume`) is the first.
 *
 * `identityHeader` / `actions` / the four universal-tab `render` functions
 * are thin adapters, defined in `./entityDescriptorRegions` (a separate
 * module because they are components and this file's export,
 * `shidduchimDescriptor`, is not — `react-refresh/only-export-components`
 * flags a file mixing the two). Neither `ShidduchShowHeader`'s nor
 * `ShidduchStateControl`'s own prop signature changes (AC 6): both are
 * relocated, not rewritten. `ResumeTab` (Story 5.3) is imported directly
 * here instead, exactly like `ShidduchOverviewTab` — it lives in its own
 * top-level `resumes/` folder, not under `shidduchim/`, because a resume is
 * shared with the single's own 360 later (Story 5.8), and it reaches the
 * shidduch via its own `useRecordContext()`, not `targetType`/`targetId`,
 * so it does not fit `entityDescriptorRegions.tsx`'s universal-tab adapters.
 */
export const shidduchimDescriptor: EntityDescriptor<ShidduchSummary> = {
  name: "shidduchim",
  label: "Shidduchim",
  buildRecordPath: (id) => `/shidduchim/${id}`,
  identityHeader: ShidduchIdentityHeader,
  actions: ShidduchActions,
  tabs: [
    { key: "overview", render: () => <ShidduchOverviewTab /> },
    { key: "resume", render: () => <ResumeTab /> },
    { key: "diligence", render: () => <ShidduchDiligenceTab /> },
    { key: "notes", render: () => <ShidduchNotesTab /> },
    { key: "tasks", render: () => <ShidduchTasksTab /> },
    { key: "activity", render: () => <ShidduchActivityTab /> },
  ],
  pendingTabs: ["photo", "medical", "files", "external-links"],
};

registerEntityDescriptor(shidduchimDescriptor, { replace: true });
