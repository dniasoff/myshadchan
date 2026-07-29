import { useStore } from "ra-core";

/** The two view modes every retrofitted `EntityList` roster supports (AC 1). */
export type EntityListViewMode = "list" | "cards";

/**
 * Per-resource, persisted List/Cards preference (AC 3). A thin wrapper over
 * ra-core's `useStore`, keyed `` `${resource}.entityListViewMode` `` — two
 * different resources never share a key (e.g. `"shadchanim.entityListViewMode"`
 * vs `"singles.entityListViewMode"`), which is what makes the choice
 * independent per entity. `root/crmStore.ts` persists every `useStore` key
 * under the app's single `"CRM"` localStorage namespace, so the value also
 * survives a reload without any second persistence mechanism here.
 *
 * `useStore`'s two-argument overload returns `[T, setter]` with no
 * `undefined` in the union when a default is supplied
 * (`node_modules/ra-core/dist/store/useStore.d.ts`), so this stays exactly
 * `useState`-shaped for callers.
 */
export function useEntityListViewMode(
  resource: string,
  defaultMode: EntityListViewMode,
): [EntityListViewMode, (mode: EntityListViewMode) => void] {
  return useStore<EntityListViewMode>(
    `${resource}.entityListViewMode`,
    defaultMode,
  );
}
