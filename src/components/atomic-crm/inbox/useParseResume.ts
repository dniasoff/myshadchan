import { useCallback, useState } from "react";
import { callAiWorker } from "../providers/commons/aiWorkerClient";
import type { InboxAttachment, InboxItem } from "../types";

/**
 * The twelve bilingual fields a resume may fill in the shidduch create form.
 * Defined here (mirroring the Worker's `ParsedResumeFields`) so the SPA does not
 * import runtime code from `workers/`.
 */
export type ParsedResumeFields = {
  name_en: string | number | null;
  name_he: string | number | null;
  parents_en: string | number | null;
  parents_he: string | number | null;
  seminary_en: string | number | null;
  seminary_he: string | number | null;
  shul_en: string | number | null;
  shul_he: string | number | null;
  location_en: string | number | null;
  location_he: string | number | null;
  age: string | number | null;
  height: string | number | null;
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

function isResumeShapedAttachment(attachment: InboxAttachment): boolean {
  return (
    attachment.type.startsWith("application/pdf") ||
    attachment.type.startsWith("image/")
  );
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
