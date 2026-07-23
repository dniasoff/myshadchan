import type { Identifier } from "ra-core";

import type { TaskTargetType } from "../types";

/**
 * The reminders hub links every task to the entity it is about (FR44-46's
 * polymorphic tasks.target_type/target_id, AD-13). This file is the single
 * place that maps a target type onto the resource it lives in, the route to
 * its detail page, and a calm English label — so `ReminderCard` and
 * `ReminderCreateSheet` never hardcode this mapping twice.
 */

/** The linkable target types this hub offers when creating a reminder. */
export const LINKABLE_TARGET_TYPES: readonly TaskTargetType[] = [
  "shidduch",
  "reference",
  "shadchan",
];

/** react-admin resource name backing each polymorphic target type. */
export const RESOURCE_FOR_TARGET: Record<TaskTargetType, string> = {
  shidduch: "shidduchim",
  reference: "references",
  shadchan: "shadchanim",
  contact: "contacts",
};

/** Calm, singular English label for each target type (used in pickers/cards). */
export const TARGET_TYPE_LABEL: Record<TaskTargetType, string> = {
  shidduch: "Suggestion",
  reference: "Reference",
  shadchan: "Shadchan",
  contact: "Contact",
};

/** Route to the entity's detail page. `shadchanim` has no /show — edit is its detail view. */
export const targetEntityPath = (
  type: TaskTargetType,
  id: Identifier,
): string => {
  switch (type) {
    case "shidduch":
      return `/shidduchim/${id}/show`;
    case "reference":
      return `/references/${id}/show`;
    case "shadchan":
      return `/shadchanim/${id}`;
    case "contact":
    default:
      return `/contacts/${id}/show`;
  }
};

/** Best-effort bilingual label for a fetched entity record, whichever type it is. */
export const targetEntityLabel = (
  type: TaskTargetType,
  record: Record<string, unknown> | undefined,
): { label: string; labelHe?: string | null } => {
  if (!record) return { label: TARGET_TYPE_LABEL[type] };

  switch (type) {
    case "shidduch":
      return {
        label: (record.name_en as string) || (record.name_he as string) || "Suggestion",
        labelHe: record.name_he as string | null,
      };
    case "reference":
      return {
        label: (record.name_en as string) || (record.name_he as string) || "Reference",
        labelHe: record.name_he as string | null,
      };
    case "shadchan":
      return {
        label: (record.name as string) || "Shadchan",
        labelHe: record.name_he as string | null,
      };
    case "contact":
    default:
      return {
        label:
          [record.first_name, record.last_name]
            .filter(Boolean)
            .join(" ") || "Contact",
      };
  }
};
