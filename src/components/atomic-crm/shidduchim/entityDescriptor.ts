import type { EntityDescriptor } from "../entity360/entityDescriptor";
import { registerEntityDescriptor } from "../entity360/registry";

/**
 * Story 3.9 stub — written as a file Epic 5 (Story 5.1) will REPLACE
 * wholesale via `registerEntityDescriptor(shidduchimDescriptor, { replace:
 * true })` (contract §4 rules 2 and 5), not as one literal among four in a
 * shared module four Epic 5 stories would hand-edit concurrently.
 *
 * `pendingTabs` carries this entity's FULL canonical tab set (contract §3
 * rule 5): nothing is built yet, and there is no separate stub-exemption
 * list — a stub is simply the extreme case of `keys(tabs) ∪ pendingTabs`
 * equalling the canonical row.
 *
 * UX-DR3 violation, stated honestly rather than silently: `shidduchim`
 * today has NO real `/shidduchim/:id/show` route. `shidduchim/index.ts`
 * exports `{ list: ShidduchimList }` only; `ShidduchimList.tsx` itself does
 * `matchPath("/shidduchim/:id/show", …)` to open `ShidduchShow`, which is a
 * routed `<Dialog>` OVER the board — self-documented at
 * `ShidduchShow.tsx:18-24` as "a routed Dialog … not a `Show`". Because
 * `<Resource>` computes `hasShow: !!show || !!hasShow`
 * (`ra-core/dist/core/Resource.js:33-34`) and `shidduchim` registers no
 * `show`, `hasShow` is `false` today, and any ra-core machinery gated on it
 * disagrees with this descriptor. The path below is nonetheless the real,
 * working route the Dialog listens on — it is honest, not aspirational.
 * Story 5.1 kills the dialog, ships a real routed `Show`, and un-pins this
 * path in the same diff.
 */
export const shidduchimDescriptor: EntityDescriptor = {
  name: "shidduchim",
  label: "Shidduchim",
  buildRecordPath: (id) => `/shidduchim/${id}/show`,
  tabs: [],
  pendingTabs: [
    "overview",
    "resume",
    "photo",
    "medical",
    "files",
    "diligence",
    "external-links",
    "notes",
    "tasks",
    "activity",
  ],
};

registerEntityDescriptor(shidduchimDescriptor);
