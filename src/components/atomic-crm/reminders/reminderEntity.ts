import type { TaskTargetType } from "../types";

/**
 * The reminders hub links every task to the entity it is about (FR44-46's
 * polymorphic tasks.target_type/target_id, AD-13). This file is the single
 * place that maps a target type onto the resource it lives in and a calm
 * English label — so `ReminderCard` and `ReminderCreateSheet` never
 * hardcode this mapping twice. The route to the entity's detail page is
 * `RecordLink`'s job now (`entity360/RecordLink.tsx`, contract §7) — this
 * file no longer builds paths at all.
 */

/**
 * The linkable target types this hub offers when creating a reminder.
 * Deliberately THREE, not four: `tasks_target_type_check`
 * (`supabase/schemas/01_tables.sql`) is still `in ('shadchan', 'shidduch',
 * 'reference')` — `single` is illegal there until Story 3.8 widens the
 * constraint. Story 3.8 adds `"single"` here in the same diff as that
 * migration; adding it here first would let this picker submit an insert
 * Postgres rejects.
 */
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
  single: "singles",
};

/** Calm, singular English label for each target type (used in pickers/cards). AD-23 vocabulary — never the retired placeholder word for a shidduch. */
export const TARGET_TYPE_LABEL: Record<TaskTargetType, string> = {
  shidduch: "Shidduch",
  reference: "Reference",
  shadchan: "Shadchan",
  single: "Single",
};

/**
 * Plural form of `TARGET_TYPE_LABEL`, for copy like "No shidduchim yet" that
 * a naive `+ "s"` would mangle into "shidduchs". `ReminderCreateSheet` is
 * the one consumer.
 */
export const TARGET_TYPE_LABEL_PLURAL: Record<TaskTargetType, string> = {
  shidduch: "shidduchim",
  reference: "references",
  shadchan: "shadchanim",
  single: "singles",
};

/** Best-effort English label for a fetched entity record, whichever type it is. */
export const targetEntityLabel = (
  type: TaskTargetType,
  record: Record<string, unknown> | undefined,
): { label: string } => {
  if (!record) return { label: TARGET_TYPE_LABEL[type] };

  switch (type) {
    case "shidduch":
      return {
        label: (record.name_en as string) || "Shidduch",
      };
    case "reference":
      return {
        label: (record.name_en as string) || "Reference",
      };
    case "single":
      // Mirrors singles/index.ts's recordRepresentation — public.singles has
      // no `name` column, only first_name_en/last_name_en (types.ts).
      return {
        label:
          [record.first_name_en, record.last_name_en]
            .filter(Boolean)
            .join(" ") || "Single",
      };
    case "shadchan":
    default:
      return {
        label: (record.name as string) || "Shadchan",
      };
  }
};
