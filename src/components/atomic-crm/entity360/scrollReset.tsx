import { useEffect } from "react";
import type { ReactElement, ReactNode } from "react";

import { resetScrollToTop } from "./resetScrollToTop";

/**
 * Wraps `New`/`Edit` in `buildEntityRoutes` — routes that, unlike the two
 * record (Show) routes, have no effect of their own — so contract §5 rule 9
 * ("suppress it for the non-index routes") covers them too, not only `:id`
 * and `:id/:tab`. Mount-only: `new` and `:id/edit` are each matched by a
 * single `<Route>`, so React keeps this same instance mounted across an id
 * change within `:id/edit` (e.g. `/1/edit` -> `/2/edit`) — AC 11's "resets
 * again when the id changes" requirement is scoped to the Show routes only
 * (`RecordRoute.tsx` covers that case separately). See `resetScrollToTop.ts`
 * for why the reset itself must be deferred via `queueMicrotask`.
 */
export function ScrollToTopOnMount({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  useEffect(resetScrollToTop, []);
  return <>{children}</>;
}
