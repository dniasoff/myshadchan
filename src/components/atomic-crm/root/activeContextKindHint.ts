import { useEffect } from "react";
import { useEvent, useStore } from "ra-core";

import { pickActiveContext } from "../providers/commons/roleAuthority";
import { useMyContexts } from "./useMyContexts";

/**
 * CLS fix (Epic 9 layout-shift regression sweep): a CRM-store hint of the
 * caller's active context `kind`, warmed here and read by Settings-only
 * sections that need to know "household or shadchanus" before their own
 * first paint — `settings/ShadchanListingSection.tsx` today. The same
 * "reserve the settled height" mechanism `layout/DemoBanner.tsx`
 * established for its own boolean, generalised to a three-way value.
 *
 * Why this can't be warmed from inside the Settings-only consumer itself:
 * see `root/singleListingShapeHint.ts`'s own module comment — the short
 * version is that `page.reload()` cancels whatever a Settings-only
 * component's own queries were mid-flight, every time, so a hint written
 * only from within Settings never gets a first chance to warm before the
 * very reload it needs to survive. `useMyContexts()` itself resolves
 * during the earlier dashboard visit instead (`OnboardingGate.tsx` already
 * depends on it there), so a hook mounted at the shell level — `layout/
 * Layout.tsx` / `layout/MobileLayout.tsx`, alongside `DemoBanner` and
 * `singleListingShapeHint.ts`'s own warmer — gets the dwell time a
 * Settings-local writer cannot.
 *
 * Deliberately narrower than `singleListingShapeHint.ts`: this hook only
 * ever knows `kind`, nothing about a listing's own field-by-field content.
 * That is enough for `ShadchanListingSection.tsx`, whose own "is the
 * account even shadchanus" pending window is what caused ~93% of the
 * `SingleListingSection.tsx` regression this sweep started from
 * (`e2e/demo-banner-cls.spec.ts`'s own measurement: a `kind`-only fix
 * closed 0.091 of 0.097 CLS there) — the remaining, much smaller residual
 * from the listing form's own field-by-field pending state is absorbed by
 * `PublishShadchanListingSection.tsx` rendering the SAME skeleton markup
 * both before and after this hook's own kind resolves (see that file's
 * exported `PublishShadchanListingSkeleton`), rather than a second,
 * count-shaped hint this section has no natural row count to reserve.
 */
const ACTIVE_CONTEXT_KIND_HINT_KEY = "activeContext.lastKnownKind";

export type ActiveContextKindHint = "household" | "shadchanus" | null;

/** Read-only — `settings/ShadchanListingSection.tsx` and any future
 * Settings-only consumer read the hint this way. */
export const useActiveContextKindHint = (): ActiveContextKindHint => {
  const [hint] = useStore<ActiveContextKindHint>(
    ACTIVE_CONTEXT_KIND_HINT_KEY,
    null,
  );
  return hint === "household" || hint === "shadchanus" ? hint : null;
};

/**
 * Renderless — call once, high in the authenticated shell. Writes the
 * live answer the moment `useMyContexts()` resolves; never writes while
 * pending, so a stale hint is only ever replaced by a real one.
 */
export const useActiveContextKindWarmer = (): void => {
  const { data: contexts, isPending } = useMyContexts();
  const [hint, setHint] = useStore<ActiveContextKindHint>(
    ACTIVE_CONTEXT_KIND_HINT_KEY,
    null,
  );

  // `useEvent` (ra-core) keeps this reference stable across renders — see
  // `singleListingShapeHint.ts`'s own `useShapeHintWriter` for why that
  // matters (naming it as a real effect dependency below, rather than
  // suppressing `react-hooks/exhaustive-deps`, given this repo ratchets
  // down `eslint-disable` comments).
  const writeHint = useEvent(() => {
    const nextHint = pickActiveContext(contexts)?.kind ?? null;
    if (hint === nextHint) return;
    setHint(nextHint);
  });

  useEffect(() => {
    if (isPending) return;
    writeHint();
  }, [isPending, writeHint]);
};
