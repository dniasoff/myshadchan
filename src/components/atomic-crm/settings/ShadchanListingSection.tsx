import type { ReactElement } from "react";

import { PublishShadchanListingSection } from "../listings/PublishShadchanListingSection";
import { pickActiveContext } from "../providers/commons/roleAuthority";
import { useMyContexts } from "../root/useMyContexts";

/**
 * Story 9.1 — the Settings wiring for the "Publish my listing" panel.
 * Renders nothing outside an active `shadchanus` context (a household has
 * no shadchan listing of its own to publish — Story 9.2's household/single
 * flow is a separate surface entirely), mirroring
 * `ConnectionSection.tsx`'s own active-context gate rather than inventing a
 * second mechanism for "which panel does this login see".
 */
export const ShadchanListingSection = (): ReactElement | null => {
  const { data: contexts } = useMyContexts();
  const activeContext = pickActiveContext(contexts);

  if (!activeContext || activeContext.kind !== "shadchanus") return null;

  return <PublishShadchanListingSection accountId={activeContext.account_id} />;
};
