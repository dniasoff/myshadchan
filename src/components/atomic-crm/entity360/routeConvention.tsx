import type { ComponentType, ReactNode } from "react";
import type { Identifier } from "ra-core";
import { Route } from "react-router";

import { buildListPath, buildRecordPath } from "./entityPaths";
import { getEntityDescriptor } from "./registry";
import { LegacyCreatePathRedirect } from "./LegacyCreatePathRedirect";

/**
 * Story 3.12 — route-convention *adoption* (Epic 3 API contract §5 scope
 * boundary). 3.2 declared the AD-24 route shape (`entityPaths.ts`,
 * `buildEntityRoutes.tsx`); this module is what makes the app's live
 * `/create` links, and `ra-core`'s own `create`/`edit`/`show` path builder,
 * point at it.
 *
 * Every path below comes from `entityPaths.ts` — nothing here composes a
 * `/{entity}/{id}…` string by template literal, except `hasAd24RecordShape`'s
 * comparison string, whose entire job is to *recognise* the AD-24 shape.
 * (`LegacyCreatePathRedirect`, the fourth piece Task 1 adds, lives in its own
 * module — a component export alongside these plain functions would trip
 * `react-refresh/only-export-components`.)
 */

/**
 * Renders `<New/>` at `new/*` (when supplied) plus a permanent `create/*` ->
 * `new` redirect, as the `children` of a `<Resource>` that has not (or not
 * yet) moved onto `buildEntityRoutes`. `<Resource>` renders `props.children`
 * inside its own `<Routes>`
 * (`node_modules/ra-core/dist/core/Resource.js:11-15`), so this fragment
 * becomes a sibling of `<Resource>`'s own `create`/`show`/`edit`/`list`
 * routes. Route matching is by rank, not declaration order: the static `new`
 * and `create` segments outrank both `:id` (a migrated entity's own dynamic
 * route) and `/*` (an unmigrated entity's `list` catch-all — e.g.
 * `shidduchim`, whose `ShidduchimList` matches every sub-path itself).
 *
 * A plain function — it must never call a hook itself. `LegacyCreatePathRedirect`
 * is the component boundary that needs `useLocation()`.
 *
 * `shidduchim/index.ts` calls this with no `New`: its create surface is a
 * modal matched inside `ShidduchimList`, not a routed component, so only the
 * compatibility redirect applies.
 */
export function buildCreateRoutes(
  name: string,
  New?: ComponentType,
): ReactNode {
  return (
    <>
      {New ? <Route path="new/*" element={<New />} /> : null}
      <Route
        path="create/*"
        element={<LegacyCreatePathRedirect name={name} />}
      />
    </>
  );
}

/**
 * The one predicate that lets `EditButton` (AC 3) tell today's pre-migration
 * entities (`buildRecordPath` still `/{name}/{id}/show`) apart from an
 * Epic-5-migrated one (`buildRecordPath` already `/{name}/{id}`) — derived
 * from the descriptor itself, so the transition happens on the exact commit
 * that flips `buildRecordPath`, with no second edit anywhere else. An
 * unregistered resource is not AD-24-shaped either, so this returns `false`
 * (never throws) when no descriptor exists.
 */
export function hasAd24RecordShape(name: string, id: Identifier): boolean {
  return (
    getEntityDescriptor(name)?.buildRecordPath(id) ===
    `/${name}/${encodeURIComponent(id)}`
  );
}

/**
 * The `RedirectToFunction` alternative to the `redirect` verb string this
 * story retires from the four create/edit surfaces (AC 4). `useRedirect`
 * accepts a function in place of that verb — see `RedirectToFunction` at
 * `node_modules/ra-core/dist/routing/useRedirect.d.ts` (not part of
 * `ra-core`'s public export surface, so it is not imported by name here; a
 * `redirect` prop only checks that this function's signature is
 * structurally compatible, which it is). Resolves through `buildRecordPath`,
 * never `buildEditPath` or the hardcoded show-record verb, so a successful
 * create or edit lands on the record and follows Epic 5's one-line
 * `buildRecordPath` flip automatically.
 */
export function redirectToRecord(resource?: string, id?: Identifier): string {
  if (resource == null) return "/";
  if (id == null) return buildListPath(resource);
  return buildRecordPath(resource, id);
}
