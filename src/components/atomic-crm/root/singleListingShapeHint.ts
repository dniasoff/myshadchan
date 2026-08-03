import { useEffect } from "react";
import { useEvent, useGetList, useStore } from "ra-core";

import { pickActiveContext } from "../providers/commons/roleAuthority";
import type { Single } from "../types";
import { useMyContexts } from "./useMyContexts";

/**
 * CLS fix (Epic 9's Settings layout-shift regression,
 * `e2e/demo-banner-cls.spec.ts` + `e2e/single-listing-section-cls.spec.ts`):
 * a CRM-store hint of what `settings/SingleListingSection.tsx` will render
 * once settled — the same "reserve the settled height" mechanism
 * `layout/DemoBanner.tsx` established for its own boolean (`demo.
 * lastKnown`), generalised to a household flag plus a row count.
 *
 * Why this can't be warmed from inside `SingleListingSection.tsx` alone: a
 * `useStore` hint only helps a component's own first paint if it was
 * written on an EARLIER page visit that had time to let the write's own
 * network round trip finish. Settings-only components never get that —
 * `e2e/fixtures.ts`'s `signIn()` lands on the dashboard, and both CLS
 * specs' own cold-load helper goes straight from a same-document
 * `goto("#/settings")` into an immediate `reload()`, which cancels
 * whatever `SingleListingSection.tsx`'s own queries were mid-flight
 * (measured: `ERR_ABORTED` on every one of them) — so a hint written only
 * from within Settings never gets a first chance to warm before the very
 * reload it needs to survive.
 *
 * `useMyContexts()` itself resolves during that earlier dashboard visit
 * instead (`OnboardingGate.tsx` already depends on it there), so the
 * `kind` half of this hint is cheap to warm from a hook mounted at the
 * shell level. The row-count half needs its own query — measured to
 * matter: a `kind`-only hint (reserve the card's existence, zero rows)
 * left a real, count-proportional residual on a genuinely first Settings
 * visit (0.0128 CLS at one single, 0.0696 at four — both over the 0.01
 * budget), because the empty-state text is shorter than even one real row.
 * The extra query mirrors `settings/FamilySection.tsx`'s own
 * `{ pagination: { page: 1, perPage: 1 } }` shape — count only, no rows.
 *
 * Fired unconditionally, not gated on `isHousehold` the way
 * `SingleListingSection.tsx`'s own (much larger, `perPage: 100`) fetch is:
 * gating this one the same way would make it wait for `useMyContexts()` to
 * resolve FIRST before it could even start, turning two round trips that
 * could run in parallel into two that run in series — measured to matter
 * again, this time against `e2e/demo-banner-cls.spec.ts`'s own
 * precondition (it waits for the demo banner, a THIRD independent query,
 * to appear — not for this hint specifically), which a serial pair of
 * round trips missed often enough to reintroduce the regression on that
 * spec while a parallel pair does not. RLS answers a non-household caller
 * with zero rows, never an error, so firing it for a shadchanus account
 * costs one small, harmless, always-empty request — cheaper than the
 * alternative of sometimes shipping the fix half-warmed.
 */
const SHAPE_HINT_KEY = "settings.singleListing.lastShape";

export interface SingleListingShapeHint {
  isHousehold: boolean;
  /** Row count only — never names or ids. A stale count still reserves the
   * right height; stale names would flash someone else's data. */
  rowCount: number;
}

/** Defends the render against a hand-edited localStorage value: a
 * non-object, a non-boolean `isHousehold`, or a negative/non-finite
 * `rowCount` is treated as "no hint" rather than trusted. */
const isValidShapeHint = (value: unknown): value is SingleListingShapeHint => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.isHousehold === "boolean" &&
    typeof candidate.rowCount === "number" &&
    Number.isFinite(candidate.rowCount) &&
    candidate.rowCount >= 0
  );
};

/** Read-only — `settings/SingleListingSection.tsx` reads the hint this
 * way. Returns `null` for "no hint yet" and for a corrupted stored value
 * alike (both mean "nothing to reserve"). */
export const useSingleListingShapeHint = (): SingleListingShapeHint | null => {
  const [raw] = useStore<SingleListingShapeHint | null>(SHAPE_HINT_KEY, null);
  return isValidShapeHint(raw) ? raw : null;
};

/** Write side — skips the store write entirely when the value is already
 * correct, so a settled render never causes a redundant write. Wrapped in
 * `useEvent` (ra-core's own "always reads the latest closure, reference
 * never changes" hook — the same shape `useStore`'s own setter uses) so
 * the warmer below can name it as a real dependency instead of suppressing
 * `react-hooks/exhaustive-deps`: a fresh closure every render would still
 * be CORRECT there (the compare-before-write guard is what actually
 * prevents a loop, not the dependency array), but this repo ratchets down
 * `eslint-disable` comments (`scripts/check-suppressions.mjs`), so the
 * stable-reference form is the one with no suppression to spend. */
const useShapeHintWriter = () => {
  const [raw, setHint] = useStore<SingleListingShapeHint | null>(
    SHAPE_HINT_KEY,
    null,
  );
  const current = isValidShapeHint(raw) ? raw : null;

  return useEvent((next: SingleListingShapeHint) => {
    if (
      current?.isHousehold === next.isHousehold &&
      current?.rowCount === next.rowCount
    ) {
      return;
    }
    setHint(next);
  });
};

const SINGLES_COUNT_PARAMS = {
  pagination: { page: 1, perPage: 1 },
};

/**
 * Renderless — call once, high in the authenticated shell (`layout/
 * Layout.tsx` / `layout/MobileLayout.tsx`, alongside `DemoBanner`). Writes
 * the live answer the moment both `useMyContexts()` and the singles count
 * resolve (fired in parallel — see the module comment); never writes while
 * either is still pending, so a stale hint is only ever replaced by a real
 * one — never blanked out mid-flight.
 */
export const useSingleListingShapeHintWarmer = (): void => {
  const { data: contexts, isPending: contextsPending } = useMyContexts();
  const isHousehold = pickActiveContext(contexts)?.kind === "household";

  const { total, isPending: countPending } = useGetList<Single>(
    "singles",
    SINGLES_COUNT_PARAMS,
  );

  const writeHint = useShapeHintWriter();

  const isSettled = !contextsPending && !countPending;

  useEffect(() => {
    if (!isSettled) return;
    writeHint({ isHousehold, rowCount: isHousehold ? (total ?? 0) : 0 });
  }, [isSettled, isHousehold, total, writeHint]);
};
