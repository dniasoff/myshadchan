import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import type { Query } from "@tanstack/query-core";

const PRIVATE_QUERY_RESOURCES = new Set([
  "interactions",
  "interactions_summary",
]);

/**
 * Note bodies are private account data. The shadchan list keeps the newest
 * live note in memory for its dialog, but the mobile CRM also persists the
 * React Query cache in localStorage. Exclude the list indicator and all
 * interaction resources from dehydration so note text never crosses that
 * persistence boundary.
 */
export const shouldPersistQuery = (query: Query): boolean => {
  const [resource, purpose] = query.queryKey;
  return (
    defaultShouldDehydrateQuery(query) &&
    !PRIVATE_QUERY_RESOURCES.has(String(resource)) &&
    !(resource === "shadchanim" && purpose === "live-note-indicators")
  );
};

/**
 * Changing this buster removes snapshots written before private note queries
 * were excluded. Without it, an old localStorage snapshot could still
 * hydrate note bodies once after the filter is deployed.
 */
export const REACT_QUERY_CACHE_BUSTER = "crm-no-private-note-cache-v1";

/** Shared mobile persistence policy. The persister itself is created where
 * the browser `localStorage` object is available, in `CRM.tsx`. */
export const mobilePersistOptions = {
  buster: REACT_QUERY_CACHE_BUSTER,
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
};
