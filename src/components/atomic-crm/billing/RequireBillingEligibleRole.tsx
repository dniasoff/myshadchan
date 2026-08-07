import type { ReactNode } from "react";
import { Navigate } from "react-router";

import { pickActiveRole } from "../providers/commons/roleAuthority";
import { useMyContexts } from "../root/useMyContexts";

/**
 * Review fix (B5, Epic 12 adversarial review). `subscription`/`ai_usage`
 * RLS (05_policies.sql) denies the `single` role entirely
 * (`current_member_role() <> 'single'`), so a `single` caller who reaches
 * `/billing` can complete Checkout, pay, and then NEVER observe or use what
 * they bought — `ai_entitlement()` reads through that same denied policy
 * and always reports unentitled for them, regardless of what the webhook
 * writes. `/billing` previously had no route guard at all.
 *
 * Mirrors `layout/RequireContextKind.tsx`'s own shape (redirect on a
 * DEFINITE mismatch, render `children` while the role is unresolved) rather
 * than introducing a second guard mechanism — this file stays inside
 * `billing/**` (this story's declared scope) instead of extending that
 * component or `root/adminRouteBuilders.tsx`'s wrapping, which are not.
 * This is defense-in-depth alongside the Worker's own identical check
 * (`workers/billing/index.ts`'s `isEligibleForBilling`) — the Worker is the
 * actual enforcement (a modified client could skip this component
 * entirely); this only keeps an eligible-looking "Subscribe" button from
 * ever rendering for a caller who can never benefit from clicking it.
 */
export const RequireBillingEligibleRole = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { data: contexts } = useMyContexts();
  const role = pickActiveRole(contexts);

  if (role === "single") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
