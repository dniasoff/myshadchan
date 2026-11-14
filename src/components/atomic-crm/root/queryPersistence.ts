import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import type { Query } from "@tanstack/query-core";

const PRIVATE_QUERY_RESOURCES = new Set([
  "interactions",
  "interactions_summary",
  "inbox_items",
  "inbox_items_summary",
  "resumes",
]);

/**
 * Note bodies, Inbox captures, and resume file metadata are private account
 * data. The mobile CRM persists the React Query cache in localStorage, so
 * exclude every resource that can carry note text, Inbox message text,
 * signed attachment URLs, or resume storage paths from dehydration.
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
 * Changing this buster removes snapshots written before the Inbox/resume
 * privacy boundary. Without it, an old localStorage snapshot could still
 * hydrate private text, signed URLs, or storage paths once after the filter
 * is deployed.
 */
export const REACT_QUERY_CACHE_BUSTER = "crm-no-private-sensitive-cache-v2";

/** Shared mobile persistence policy. The persister itself is created where
 * the browser `localStorage` object is available, in `CRM.tsx`. */
export const mobilePersistOptions = {
  buster: REACT_QUERY_CACHE_BUSTER,
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
};
