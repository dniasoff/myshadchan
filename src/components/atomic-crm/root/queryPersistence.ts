import type { Query } from "@tanstack/query-core";

/**
 * Note bodies are private account data. The shadchan list keeps the newest
 * live note in memory for its dialog, but the mobile CRM also persists the
 * React Query cache in localStorage. Exclude this exact query family from
 * dehydration so note text never crosses that persistence boundary.
 */
export const shouldPersistQuery = (query: Query): boolean => {
  const [resource, purpose] = query.queryKey;
  return !(resource === "shadchanim" && purpose === "live-note-indicators");
};

/**
 * Changing this buster removes snapshots written before private note queries
 * were excluded. Without it, an old localStorage snapshot could still
 * hydrate note bodies once after the filter is deployed.
 */
export const REACT_QUERY_CACHE_BUSTER = "crm-no-private-note-cache-v1";
