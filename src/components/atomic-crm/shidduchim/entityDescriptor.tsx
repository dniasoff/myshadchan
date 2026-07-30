import type { EntityDescriptor } from "../entity360/entityDescriptor";
import { registerEntityDescriptor } from "../entity360/registry";
import { PhotoTab } from "../resumes/PhotoTab";
import { ResumeTab } from "../resumes/ResumeTab";
import { ExternalLinksTab } from "./ExternalLinksTab";
import { MedicalTab } from "./MedicalTab";
import { ShidduchOverviewTab } from "./ShidduchOverviewTab";
import { ShidduchRightRail } from "./ShidduchRightRail";
import {
  ShidduchActions,
  ShidduchActivityTab,
  ShidduchDiligenceTab,
  ShidduchFilesTab,
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
 *
 * Story 5.4 moves `photo` out of `pendingTabs` and into `tabs`, in
 * canonical position (`photo` follows `resume` —
 * `entity360/ad24Conformance.ts`'s `CANONICAL_TAB_SETS.shidduchim`) — the
 * same diff that builds `PhotoTab`, per AD-24's hand-off note (b): a story
 * that builds a tab moves its key, or the tab ships built-and-unmounted. No
 * `label` override: "Photo" is already the i18n default
 * (`entity360/tabKeys.ts`), and an override would need a "why THIS entity
 * deviates" comment for a deviation that does not exist. `PhotoTab` lives
 * in `resumes/`, alongside `ResumeTab`, for the same reason: a photo
 * belongs to the shidduch's resume record, not to `shidduchim/`.
 *
 * Story 5.5 moves `medical` out of `pendingTabs` and into `tabs`, in
 * canonical position (`medical` follows `photo` — `CANONICAL_TAB_SETS`
 * again), the same diff that builds `MedicalTab`. `visibleTo:
 * ["parent_admin", "self_manager"]` is an explicit allow-list, not an
 * ordered threshold (contract §2 — there is no `minVisibility`): the three
 * omitted `MemberRole` values (`helper`, `shadchan`, `single`) are each
 * denied. RLS (05_policies.sql) is the authoritative boundary; this is the
 * courtesy that keeps a denied viewer's client from ever requesting the
 * tab's data. `MedicalTab` lives in `shidduchim/`, unlike `ResumeTab`/
 * `PhotoTab` — a medical note is shidduch-scoped only per this epic, with
 * no single-level or shadchan-level concept, so it has no reason to live
 * outside this entity's own folder.
 *
 * Story 5.6 moves the last two keys, `files` and `external-links`, out of
 * `pendingTabs` and into `tabs`, in canonical position
 * (`CANONICAL_TAB_SETS.shidduchim`) — the same diff that wires `FilesTab`
 * (Story 3.7's universal tab, wrapped by `ShidduchFilesTab` for the
 * `targetType`/`targetId` adapter) and builds `ExternalLinksTab` (a new,
 * shidduch-only tab — no other Epic 5 story asks for it elsewhere, so it is
 * not made polymorphic, per YAGNI). `pendingTabs` is now empty: this is the
 * shidduch descriptor's last pending key.
 *
 * Story 5.7 sets `rightRail: ShidduchRightRail` — this story's ONLY edit to
 * this file. It declares no tab and touches neither `tabs` nor
 * `pendingTabs`: `rightRail` is a region, not a tab (contract §11 Ruling 2 —
 * the rail is a compact, read-only summary that links into the canonical
 * Tasks tab, never a second mutation surface). `ShidduchRightRail` lives in
 * `shidduchim/`, alongside its two panels, imported directly here exactly
 * like `ShidduchOverviewTab`/`ResumeTab`.
 */
export const shidduchimDescriptor: EntityDescriptor<ShidduchSummary> = {
  name: "shidduchim",
  label: "Shidduchim",
  buildRecordPath: (id) => `/shidduchim/${id}`,
  identityHeader: ShidduchIdentityHeader,
  actions: ShidduchActions,
  rightRail: ShidduchRightRail,
  tabs: [
    { key: "overview", render: () => <ShidduchOverviewTab /> },
    { key: "resume", render: () => <ResumeTab /> },
    { key: "photo", render: () => <PhotoTab /> },
    {
      key: "medical",
      visibleTo: ["parent_admin", "self_manager"],
      render: () => <MedicalTab />,
    },
    { key: "files", render: () => <ShidduchFilesTab /> },
    { key: "diligence", render: () => <ShidduchDiligenceTab /> },
    { key: "external-links", render: () => <ExternalLinksTab /> },
    { key: "notes", render: () => <ShidduchNotesTab /> },
    {
      key: "tasks",
      // Story 6.2 (AC 10): tasks is one of the tables RLS empties for a
      // single (05_policies.sql) — hide the now-permanently-empty tab
      // rather than leave it as a dead shell (visibleTo is an allow-list,
      // so excluding `single` means naming the other four roles).
      visibleTo: ["parent_admin", "self_manager", "helper", "shadchan"],
      render: () => <ShidduchTasksTab />,
    },
    { key: "activity", render: () => <ShidduchActivityTab /> },
  ],
  pendingTabs: [],
};

registerEntityDescriptor(shidduchimDescriptor, { replace: true });
