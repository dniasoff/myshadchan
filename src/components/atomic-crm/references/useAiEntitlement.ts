import { useQuery } from "@tanstack/react-query";
import { useDataProvider } from "ra-core";

import { UNENTITLED_AI } from "../providers/commons/aiEntitlement";
import type { CrmDataProvider } from "../providers/types";
import type { AiEntitlementInfo } from "../types";

/**
 * THE ENTITLEMENT SEAM (E4) — now server-authoritative.
 *
 * The research assistant (FR59-63) and the future resume auto-parse are the ONLY
 * paid surfaces. This hook is the single client-side gate in front of them, and
 * it no longer decides anything itself: it asks the server's ai_entitlement()
 * RPC (via the data provider) and reports the answer. The decision derives from
 * the SELECT-only `subscription` table, whose only writer is service_role, so a
 * modified client cannot forge entitlement — and before real inference is spent,
 * the (future) AI edge functions re-run the SAME function server-side. This is
 * exactly what the retired hardcoded placeholder warned had to happen.
 *
 * Two things must stay true:
 *
 *  1. The decision is the server's, not the browser's. This hook only reflects
 *     it. On any read failure it falls back to UNENTITLED (fail closed) so a
 *     broken read can never unlock the paid surface.
 *
 *  2. Nothing else in the References surface may call this. The timeline, notes,
 *     reminders, call log, merge, catch and — above all — match-on-entry are
 *     free by requirement (FR20/FR42 are explicitly not paywalled) and must
 *     never consult this hook.
 */

/** Shared cache key so the References gate and the Billing page issue ONE
 * ai_entitlement() call per session, not two. */
export const AI_ENTITLEMENT_QUERY_KEY = ["aiEntitlement"] as const;

export type AiEntitlement = {
  isEntitled: boolean;
  isLoading: boolean;
};

/** The full server entitlement payload for the Billing page (plan, status,
 * usage meter), plus the query's loading flag. */
export const useAiEntitlementInfo = (): {
  info: AiEntitlementInfo;
  isLoading: boolean;
} => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data, isLoading } = useQuery({
    queryKey: AI_ENTITLEMENT_QUERY_KEY,
    queryFn: () => dataProvider.aiEntitlement(),
  });
  return { info: data ?? UNENTITLED_AI, isLoading };
};

/** The boolean gate consumed by ResearchAssistantPanel — deliberately the same
 * `{ isEntitled, isLoading }` shape the placeholder returned, so the panel needs
 * no behavioral change. */
export const useAiEntitlement = (): AiEntitlement => {
  const { info, isLoading } = useAiEntitlementInfo();
  return { isEntitled: info.is_entitled, isLoading };
};
