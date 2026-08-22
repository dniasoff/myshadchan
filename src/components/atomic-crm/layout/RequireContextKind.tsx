import type { ReactNode } from "react";
import { Navigate } from "react-router";

import { useActiveContextKind, type ContextKind } from "./navItems";

export interface RequireContextKindProps {
  /** The context kind this route requires to render. */
  kind: ContextKind | readonly ContextKind[];
  /** Where to send the user when the active context's kind does not match. */
  redirectTo: string;
  children: ReactNode;
}

/**
 * Story 8.1 (AC-3): the one route guard — not per-route ad-hoc checks — that
 * keeps a household-only screen unreachable while a shadchanus context is
 * active, and reusable in the other direction (Story 8.5 uses
 * `kind="shadchanus"` on the `connections` resource, the same mechanism).
 *
 * This is defense-in-depth on top of AD-2's DB-level guarantee that a
 * shadchanus account never holds household domain rows — Epic 2 Story 2.2
 * owns that guarantee; this component only prevents the client from ever
 * rendering the mismatched screen in the first place, so a context-switch
 * mid-session or a stale bookmark never shows "0 singles" instead of the
 * dashboard.
 *
 * Renders `children` (not a redirect) whenever `useActiveContextKind()`
 * returns `undefined` — `useMyContexts()` still pending/errored, OR loaded
 * with no row carrying `is_active: true` (a real, server-reachable state:
 * see `navItems.ts`'s `useActiveContextKind()` doc, Story 8.1 review F4) —
 * rather than redirecting away from every guarded route whenever the active
 * context can't be resolved. AD-2 already empties the underlying data
 * server-side, so a brief render of the real screen before the guard
 * resolves is a flicker of an empty list, never a data leak (mirrors
 * `root/OnboardingGate.tsx`'s own "fail toward the shell" precedent).
 */
export const RequireContextKind = ({
  kind,
  redirectTo,
  children,
}: RequireContextKindProps) => {
  const activeKind = useActiveContextKind();
  const allowedKinds = Array.isArray(kind) ? kind : [kind];

  if (activeKind !== undefined && !allowedKinds.includes(activeKind)) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
};
