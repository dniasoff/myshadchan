import type { Identifier } from "ra-core";

import { requireEntityDescriptor } from "./registry";
import type { TabKey } from "./tabKeys";

/**
 * AD-24's one module for building an entity URL (Epic 3 API contract §4).
 * Nothing else in the app builds a `/{entity}/{id}…` string by template
 * literal — every builder below goes through `requireEntityDescriptor`
 * first, so an unregistered resource throws rather than producing a
 * plausible-but-dead URL, and `buildRecordPath` / `buildTabPath` delegate to
 * the descriptor, which is what makes Epic 5's one-line `buildRecordPath`
 * flip (`/{r}/{id}/show` -> `/{r}/{id}`) propagate to tab links and deep
 * links at once.
 */

/** `/${name}` */
export function buildListPath(name: string): string {
  requireEntityDescriptor(name);
  return `/${name}`;
}

/**
 * Where to send someone who has to go SOMEWHERE and has no record to go to:
 * the entity's list when it has one, `/` when it does not.
 *
 * The two callers are framework fallbacks, not navigation — `RecordUnavailable`
 * ("this record is unavailable, go back") and `redirectToRecord`'s `id == null`
 * branch. Both used to call `buildListPath` unconditionally, which for a
 * no-browse entity (`descriptor.browsable === false`, RULING 7) walked the
 * user straight into the surface the ruling closed. This is deliberately NOT
 * folded into `buildListPath`: an explicit `buildListPath` call with a no-browse name is a
 * defect the AD-24 guard reports, and silently rewriting it to `/` would hide
 * that.
 */
export function buildBrowseFallbackPath(name: string): string {
  const descriptor = requireEntityDescriptor(name);
  return descriptor.browsable === false ? "/" : buildListPath(name);
}

/** `/${name}/new`. Serves AC 8's route; this story renames no live link —
 * that adoption is Story 3.12's (contract §5 scope boundary). */
export function buildNewPath(name: string): string {
  requireEntityDescriptor(name);
  return `/${name}/new`;
}

/** Delegates to `descriptor.buildRecordPath(id)` — never composed by this
 * module, so an Epic 5 migration's one-line descriptor edit is the only
 * change needed to move every record link at once. */
export function buildRecordPath(name: string, id: Identifier): string {
  const descriptor = requireEntityDescriptor(name);
  return descriptor.buildRecordPath(id);
}

/**
 * Deliberately a literal, NOT `` `${buildRecordPath(name, id)}/edit` `` (see
 * the story's Dev Notes, "Why `buildEditPath` is a literal"). Before an
 * entity migrates onto `Entity360`, its descriptor's `buildRecordPath`
 * returns `/{name}/{id}/show` (contract §2 — Epic 5 flips it), so composing
 * from it would produce `/shadchanim/1/show/edit`, which `react-router`
 * ranks onto `<Resource>`'s `:id/show/*` route and renders the show
 * surface, not edit. `/{name}/{id}/edit` as a literal resolves correctly in
 * both worlds: for a not-yet-migrated entity it matches `<Resource>`'s
 * `:id/*` splat (`ShadchanEdit`); after migration (e.g. `singles`, Story
 * 5.8) it matches `buildEntityRoutes`'s explicit `:id/edit`.
 */
export function buildEditPath(name: string, id: Identifier): string {
  requireEntityDescriptor(name);
  return `/${name}/${id}/edit`;
}

/**
 * Derived from `buildRecordPath` (unlike `buildEditPath`): tabs exist only
 * on entities that have already migrated onto `Entity360`, so there is no
 * pre-migration shape to protect against. This is what makes Epic 5's
 * one-line `buildRecordPath` flip propagate to every tab link too.
 */
export function buildTabPath(
  name: string,
  id: Identifier,
  tab: TabKey,
): string {
  const descriptor = requireEntityDescriptor(name);
  return `${descriptor.buildRecordPath(id)}/${tab}`;
}
