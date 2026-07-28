import type { ComponentType, ReactElement } from "react";
import { Route, Routes } from "react-router";

import { RecordRoute } from "./RecordRoute";

export interface BuildEntityRoutesConfig {
  List: ComponentType;
  New?: ComponentType;
  Edit?: ComponentType;
  /** Normally `EntityShow` (Story 3.3b). No props — reads resource and
   * record from context, never from a prop (contract §4 rule 4). */
  Show: ComponentType;
}

/**
 * AD-24's route table for one entity (Epic 3 API contract §5) — what a
 * migrated entity's `<Resource>` points its `list` prop at. Returns:
 *
 * | Path         | Renders                        |
 * |--------------|---------------------------------|
 * | `index`      | `<List/>`                       |
 * | `new`        | `<New/>` (when supplied)        |
 * | `:id/edit`   | `<Edit/>` (when supplied)       |
 * | `:id`        | `<ShowBase><Show/></ShowBase>`  |
 * | `:id/:tab`   | `<ShowBase><Show/></ShowBase>`  |
 *
 * This sits one level below `ra-core`'s own routing, so it needs no
 * `ResourceContextProvider` of its own — the enclosing `<Resource
 * name="…">` already provides one (`ra-core/dist/core/Resource.js:9`).
 * The two record routes share `RecordRoute` (`./RecordRoute.tsx`), which
 * wraps `Show` in `ShowBase` (contract §5 rule 1) — the sole source of
 * `RecordContext`, the pending state, and the handled error state under
 * this tree — and resets scroll per AC 11.
 *
 * REGISTRATION RULE (contract §5 rule 4, enforced by Story 3.12's
 * `record-flags-missing` manifest violation — nothing under
 * `src/components/admin/` is edited by THIS story): a migrated entity
 * registers `list` ONLY on `<Resource>` — set to this function's return
 * value — PLUS explicit `hasShow` / `hasEdit` props.
 * `Resource.registerResource` computes `hasEdit: !!edit || !!hasEdit` and
 * `hasShow: !!show || !!hasShow` (`ra-core/dist/core/Resource.js:28-37`);
 * omitting the two explicit props leaves both flags `false`, and
 * `useGetPathForRecord`'s inferred-link branch — the mechanism that makes
 * `<DataTable>` row clicks navigate anywhere — never fires
 * (`ra-core/dist/routing/useGetPathForRecord.js:78-99`,
 * `admin/data-table.tsx:232-235`), leaving every row unclickable.
 *
 * Do NOT export a `newSegmentAlias` helper here — Story 3.12 supplies
 * `buildCreateRoutes` (the `/create` -> `/new` compatibility redirect); two
 * helpers for one job is exactly the drift this epic exists to stop.
 */
export function buildEntityRoutes(
  config: BuildEntityRoutesConfig,
): ReactElement {
  const { List, New, Edit, Show } = config;

  return (
    <Routes>
      <Route index element={<List />} />
      {New ? <Route path="new" element={<New />} /> : null}
      {Edit ? <Route path=":id/edit" element={<Edit />} /> : null}
      <Route path=":id" element={<RecordRoute Show={Show} />} />
      <Route path=":id/:tab" element={<RecordRoute Show={Show} />} />
    </Routes>
  );
}
