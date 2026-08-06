import { useCallback, useState } from "react";
import { callAiWorker } from "../providers/commons/aiWorkerClient";
import type { InboxAttachment, InboxItem } from "../types";

/**
 * The fourteen bilingual fields a resume may fill in the shidduch create form.
 * Defined here (mirroring the Worker's `ParsedResumeFields`) so the SPA does not
 * import runtime code from `workers/`.
 *
 * Review fix (Finding 3): father and mother are split fields, matching
 * `ShidduchInputs.tsx` / `public.shidduchim` — a combined `parents_en` /
 * `parents_he` pair had no input that rendered it and no submit mapping that
 * read it, so any parent info the model extracted was silently discarded.
 *
 * Review fix (Finding 13, Epic 11 adversarial review): narrowed from a
 * uniform `string | number | null` on every field to ONE type per field,
 * mirroring `workers/parse/parsedResumeDraft.ts`'s own Finding-13 closure —
 * `age` is the sole numeric field (`public.shidduchim.age integer`), every
 * other field, `height` included (`public.shidduchim.height text` —
 * freeform, e.g. `5'10"`, not a structured dimension), is text. The Worker
 * now coerces at its own validation boundary (`toDraft()`'s
 * `TextFieldValueSchema` / `NumericFieldValueSchema`), so `POST /parse`'s
 * response already carries this exact shape — this type just says so,
 * closing off the `as string` / `as number` assertions this mismatch used
 * to force on every caller (`InboxResolveDialog.tsx`'s `onSubmit`).
 */
export type ParsedResumeFields = {
  name_en: string | null;
  name_he: string | null;
  father_en: string | null;
  father_he: string | null;
  mother_en: string | null;
  mother_he: string | null;
  seminary_en: string | null;
  seminary_he: string | null;
  shul_en: string | null;
  shul_he: string | null;
  location_en: string | null;
  location_he: string | null;
  age: number | null;
  height: string | null;
};

export type ParsedResumeResponse = {
  fields: ParsedResumeFields;
  lowConfidenceFields: string[];
  sections: {
    learningHistory: Array<{ label: string; value: string }>;
    references: Array<{ name: string; relationship: string; phone: string }>;
  };
  rawDraft: unknown;
};

/**
 * Mirrors the Worker's `ALLOWED_ATTACHMENT_MIME_TYPES`
 * (`workers/parse/inboxAttachment.ts`, review fix Finding 9) — duplicated,
 * not imported, for the same reason as `ParsedResumeFields` above: the SPA
 * does not import runtime code from `workers/`. Kept in sync so this
 * button-visibility heuristic never renders "Auto-fill from resume" for a
 * MIME type the Worker's own authority will then reject.
 */
const RESUME_SHAPED_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

function isResumeShapedAttachment(attachment: InboxAttachment): boolean {
  return RESUME_SHAPED_MIME_TYPES.includes(attachment.type);
}

/**
 * Local, fast predicate for whether an inbox item has any attachment that looks
 * resume-shaped. The Worker's `findResumeAttachment` is the authority; this just
 * decides whether to render the auto-fill button.
 */
export function hasResumeShapedAttachment(item: InboxItem): boolean {
  return item.attachments?.some(isResumeShapedAttachment) ?? false;
}

/**
 * Hook that calls the parse Worker to turn a captured resume into an editable
 * shidduch draft.
 */
export function useParseResume() {
  const [isParsing, setIsParsing] = useState(false);

  const parse = useCallback(
    async (item: InboxItem): Promise<ParsedResumeResponse> => {
      setIsParsing(true);
      try {
        const result = await callAiWorker<ParsedResumeResponse>(
          `${import.meta.env.VITE_PARSE_WORKER_URL}/parse`,
          { inbox_item_id: item.id },
        );
        return result;
      } finally {
        setIsParsing(false);
      }
    },
    [],
  );

  return { parse, isParsing };
}
