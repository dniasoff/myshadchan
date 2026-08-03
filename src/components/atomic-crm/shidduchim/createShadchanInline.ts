import type { SupportCreateSuggestionOptions } from "ra-core";

import type { CrmDataProvider } from "../providers/types";

/**
 * FR78's inline "+ Add a shadchan" (Story 10.1, review fix F4): the same
 * one-line `dataProvider.create("shadchanim", …)` call, shared by every
 * caller that wires `ShidduchInputs.tsx`'s `onCreateShadchan` prop —
 * `ShareTarget.tsx`, `InboxResolveDialog.tsx`, and `ShidduchCreate.tsx` —
 * so the affordance is one function reused everywhere `ShidduchInputs` is,
 * not a divergent copy per screen (the same principle the story's Dev Notes
 * name for "link to an existing suggestion": one place decides how it
 * works, reused by every entry point).
 */
export function createShadchanInline(
  dataProvider: CrmDataProvider,
): SupportCreateSuggestionOptions["onCreate"] {
  return async (filter) => {
    const { data } = await dataProvider.create("shadchanim", {
      data: { name: filter ?? "" },
    });
    return data;
  };
}
