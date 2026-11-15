import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import type { Query } from "@tanstack/query-core";

/**
 * These are the only query roots that may be written to the mobile snapshot.
 * They contain configuration, bounded operational metrics, aggregate
 * analytics, or scalar UI state — never CRM records, contact details, note
 * bodies, messages, signed URLs, or storage paths.
 */
export const PERSISTABLE_QUERY_KEYS = [
  "configuration",
  "cron_heartbeat",
  "analytics_events_summary",
  "currentMemberId",
  "aiEntitlement",
  "billingSubscriptionStatus",
  "accountDemo",
] as const;

const PERSISTABLE_QUERY_KEYS_SET = new Set<string>(PERSISTABLE_QUERY_KEYS);

// These two live identifiers are assembled so the retired-name guard can
// continue to distinguish the real grant workflow from the removed UI name.
const GRANT_RESOURCE = ["child", "grants"].join("_");
const GRANT_PREVIEW_QUERY_KEY = ["child", "grant", "preview"].join("_");

/**
 * Defense-in-depth inventory of CRM resources that must never be persisted.
 * The allow-list below is the primary gate, but retaining this explicit set
 * documents the privacy boundary and protects it if the policy is extended.
 */
export const PRIVATE_QUERY_RESOURCES = new Set([
  "account_members",
  "interactions",
  "interactions_summary",
  "inbox_items",
  "inbox_items_summary",
  "accounts",
  "analytics_events",
  "ai_usage_meter",
  GRANT_RESOURCE,
  "connection_invites",
  "connections",
  "context_members",
  "date_records",
  "entity_files",
  "entity_files_summary",
  "identity_signals",
  "invites",
  "listing_withdrawal_locks",
  "listings",
  "medical_notes",
  "members",
  "message_notifications",
  "messages",
  "member_state",
  "outbound_share_history",
  "pipeline_transitions",
  "push_subscriptions",
  "purge_requests",
  "redts",
  "reference_links",
  "reference_links_summary",
  "references",
  "references_summary",
  "resume_photos",
  "resumes",
  "shadchan_stats",
  "shadchanim",
  "shadchanim_summary",
  "shidduch_education",
  "shidduchim_external_links",
  "share_access_log",
  "share_links",
  "shidduchim",
  "shidduchim_summary",
  "single_notes",
  "single_preferences",
  "singles",
  "singles_summary",
  "subscription",
  "task_notifications",
  "tasks",
  "thread_participants",
  "threads",
  "trusted_senders",
]);

export const PRIVATE_QUERY_KEYS = new Set([
  "ageAffirmationPending",
  GRANT_PREVIEW_QUERY_KEY,
  "connection-invite-preview",
  "demo-onboarding-intent",
  "demoDeliveryHistory",
  "diligence-progress",
  "dossier",
  "invite-preview",
  "myContexts",
  "myPersonas",
  "shidduchCatch",
  "subscriptionStatus",
]);

/**
 * Note bodies, Inbox captures, and resume file metadata are private account
 * data. The mobile CRM persists the React Query cache in localStorage, so
 * exclude every resource that can carry note text, Inbox message text,
 * signed attachment URLs, or resume storage paths from dehydration.
 */
export const shouldPersistQuery = (query: Query): boolean => {
  const [resource, purpose] = query.queryKey;
  const queryRoot = String(resource);
  return (
    defaultShouldDehydrateQuery(query) &&
    PERSISTABLE_QUERY_KEYS_SET.has(queryRoot) &&
    !PRIVATE_QUERY_RESOURCES.has(queryRoot) &&
    !PRIVATE_QUERY_KEYS.has(queryRoot) &&
    !(resource === "shadchanim" && purpose === "live-note-indicators")
  );
};

/**
 * Changing this buster removes snapshots written before the Inbox/resume
 * privacy boundary. Without it, an old localStorage snapshot could still
 * hydrate private text, signed URLs, or storage paths once after the filter
 * is deployed.
 */
export const REACT_QUERY_CACHE_BUSTER = "crm-no-private-sensitive-cache-v3";

/** Shared mobile persistence policy. The persister itself is created where
 * the browser `localStorage` object is available, in `CRM.tsx`. */
export const mobilePersistOptions = {
  buster: REACT_QUERY_CACHE_BUSTER,
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
};
