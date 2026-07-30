import type { Identifier } from "ra-core";

import type { ReferenceLinkSummary } from "../types";

/**
 * The one shared predicate behind "have I spoken to this person about
 * anyone else" (Story 5.10, Task 1). Lifted verbatim out of
 * `RepeatRecognitionPanel.tsx`'s own `others` computation so a second copy
 * never drifts from it.
 *
 * A link counts as an OTHER conversation only when it names a shidduch
 * (`shidduchim_id != null` — a link with no shidduch has nothing to be
 * "another" conversation about, the same guard `ReferenceCallLog.tsx` and
 * `RepeatRecognitionPanel.tsx` already apply) and that shidduch is not the
 * one `excludeShidduchimId` names (typically the shidduch the caller is
 * currently looking at).
 */
export function filterOtherConversations(
  links: ReferenceLinkSummary[],
  excludeShidduchimId?: Identifier | null,
): (ReferenceLinkSummary & { shidduchim_id: Identifier })[] {
  return links.filter(
    (link): link is ReferenceLinkSummary & { shidduchim_id: Identifier } =>
      link.shidduchim_id != null && link.shidduchim_id !== excludeShidduchimId,
  );
}

/**
 * How many OTHER shidduchim this reference has been asked about, besides
 * `excludeShidduchimId`. `RepeatRecognitionPanel.tsx` uses
 * `filterOtherConversations` directly (it needs the rows themselves, to
 * render one per shidduch); this is the plain count a caller that only
 * needs the number — never the rows — asks for instead.
 */
export function countOtherConversations(
  links: ReferenceLinkSummary[],
  excludeShidduchimId?: Identifier | null,
): number {
  return filterOtherConversations(links, excludeShidduchimId).length;
}
