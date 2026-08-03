import type { ReactElement } from "react";

import {
  PublishShadchanListingSection,
  PublishShadchanListingSkeleton,
} from "../listings/PublishShadchanListingSection";
import { pickActiveContext } from "../providers/commons/roleAuthority";
import { useActiveContextKindHint } from "../root/activeContextKindHint";
import { useMyContexts } from "../root/useMyContexts";

/**
 * Story 9.1 — the Settings wiring for the "Publish my listing" panel.
 * Renders nothing outside an active `shadchanus` context (a household has
 * no shadchan listing of its own to publish — Story 9.2's household/single
 * flow is a separate surface entirely), mirroring
 * `ConnectionSection.tsx`'s own active-context gate rather than inventing a
 * second mechanism for "which panel does this login see".
 *
 * CLS fix (Epic 9 layout-shift regression sweep): this used to return
 * `null` unconditionally while `useMyContexts()` was in flight, then pop
 * into `PublishShadchanListingSection`'s own card for a shadchanus login —
 * the same "null while pending" shape `settings/SingleListingSection.tsx`
 * was fixed for, measured here at 0.0116 CLS against the 0.01 budget for a
 * fully-populated listing (`e2e/demo-banner-cls.spec.ts`'s own sibling
 * scenario proved a `kind`-only hint alone closes ~93% of an identical
 * regression). While pending, this renders the exact same
 * `PublishShadchanListingSkeleton` markup `PublishShadchanListingSection`
 * itself falls back to for its OWN pending window — so a hint of
 * "shadchanus" hands off between the two with no visible change at all,
 * and only `PublishShadchanListingSection`'s own (much smaller) internal
 * settle remains. No row-count-shaped hint is needed here the way
 * `SingleListingSection.tsx` needed one: a shadchan has exactly one
 * listing, never a variable-length roster.
 */
export const ShadchanListingSection = (): ReactElement | null => {
  const { data: contexts, isPending } = useMyContexts();
  const activeContext = pickActiveContext(contexts);
  const kindHint = useActiveContextKindHint();

  if (isPending) {
    return kindHint === "shadchanus" ? (
      <PublishShadchanListingSkeleton />
    ) : null;
  }

  if (!activeContext || activeContext.kind !== "shadchanus") return null;

  return <PublishShadchanListingSection accountId={activeContext.account_id} />;
};
