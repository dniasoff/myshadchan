/**
 * The closed tab vocabulary (Epic 3 API contract §3). Every entity's 360
 * tabs, and every `EntityRelationshipDescriptor`, are keyed by `TabKey` —
 * never a free string.
 *
 * Adding a tab is a **one-line edit to `TAB_KEYS`, one to `TAB_LABELS`, and
 * one `crm.entity360.tab.<key>` entry in
 * `providers/commons/englishCrmMessages.ts`**, made in the same diff as the
 * story that needs it. Falling back to a free string instead of adding a
 * key here is a review-blocking defect.
 *
 * Constants only: no React, no import from any sibling directory of
 * `entity360/`, so 3.2 and 3.3a can depend on this module without pulling
 * React in.
 */
export const TAB_KEYS = [
  "overview",
  "activity",
  "notes",
  "tasks",
  "files",
  "related",
  "resume",
  "photo",
  "medical",
  "diligence",
  "diligence-progress",
  "external-links",
  "shidduchim",
  "conversations",
  "discussions",
  "assistant",
  "preferences",
  "private-notes",
] as const;

export type TabKey = (typeof TAB_KEYS)[number];

/**
 * English fallback labels, one per `TabKey`. This is the `_:` fallback set
 * consumed by `useTabLabel`, not the rendering path itself — rendering
 * always goes through the `i18nProvider` first (contract §3 rule 2).
 * `Record<TabKey, string>` makes a missing or misspelt label a `tsc` error.
 */
export const TAB_LABELS: Record<TabKey, string> = {
  overview: "Overview",
  activity: "Activity",
  notes: "Notes",
  tasks: "Tasks",
  files: "Files",
  related: "Related",
  resume: "Resume",
  photo: "Photo",
  medical: "Medical",
  diligence: "Diligence",
  "diligence-progress": "Diligence progress",
  "external-links": "External links",
  shidduchim: "Shidduchim",
  conversations: "Conversations",
  discussions: "Discussions",
  assistant: "Assistant",
  preferences: "Preferences",
  "private-notes": "Private notes",
};

/** Narrows a URL segment (or any string) to `TabKey`. Used by 3.2 to guard
 * the `:tab` route param — a stale bookmark for a retired name (e.g.
 * `suggestions`, `linked-shidduchim`) must not resolve. */
export function isTabKey(value: string): value is TabKey {
  return (TAB_KEYS as readonly string[]).includes(value);
}

/** The i18n catalog key for a tab's label: `crm.entity360.tab.<key>`. The
 * whole CRM catalog nests under a single `crm` root
 * (`providers/commons/englishCrmMessages.ts`), so a bare `entity360.tab.<key>`
 * can never resolve. */
export function tabLabelKey(key: TabKey): string {
  return `crm.entity360.tab.${key}`;
}
