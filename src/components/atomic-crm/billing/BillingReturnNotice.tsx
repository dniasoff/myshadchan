import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslate } from "ra-core";

const DEFAULT_MAX_REFRESH_ATTEMPTS = 5;
const DEFAULT_REFRESH_INTERVAL_MS = 2000;

/**
 * Renders a HINT about the Stripe Checkout return — never entitlement
 * itself (AC-13). `success_url`/`cancel_url` are plain browser redirects:
 * trivially forgeable (anyone can type `/billing?checkout=success`) and not
 * ordered against the webhook, which can arrive before, after, or not at
 * all relative to the browser reaching this page (a user who abandons
 * Checkout can still land here, and a user who completes it can close the
 * tab before this ever renders). Treating the return as a grant would
 * reintroduce exactly the client-trusted entitlement AD-16 forbids and E4
 * spent a table, two policies and four grants eliminating — "why not just
 * call a `confirm` RPC on return" is answered by `06_grants.sql`: that RPC
 * would BE the client-callable write path to `plan='ai'` those grants exist
 * to prevent. So this component only ever asks its parent to re-read server
 * state (`onNeedsRefresh`, a bounded schedule of at most `maxAttempts`
 * calls `intervalMs` apart) and reports whether it is still waiting.
 *
 * `isEntitled` is a PROP, not a hook call: it is `BillingPage`'s own
 * already-fetched `ai_entitlement()` read, passed down rather than this
 * component importing the entitlement hook module itself (the story's own
 * "keep every hook/query-key reference inside BillingPage.tsx" option for
 * the shared entitlement-gate guard test's allowlist). More importantly, it
 * means this component can never independently decide or render "you are
 * entitled" — it can only stop describing a wait once its parent's own
 * server-derived state says there is nothing left to wait for.
 */
export const BillingReturnNotice = ({
  isEntitled,
  onNeedsRefresh,
  maxAttempts = DEFAULT_MAX_REFRESH_ATTEMPTS,
  intervalMs = DEFAULT_REFRESH_INTERVAL_MS,
}: {
  isEntitled: boolean;
  onNeedsRefresh: () => void;
  maxAttempts?: number;
  intervalMs?: number;
}) => {
  const translate = useTranslate();
  const [searchParams] = useSearchParams();
  const checkoutParam = searchParams.get("checkout");
  const checkoutState =
    checkoutParam === "success" || checkoutParam === "cancelled"
      ? checkoutParam
      : null;
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (checkoutState !== "success" || isEntitled) return;
    if (attempts >= maxAttempts) return;

    const timer = setTimeout(() => {
      onNeedsRefresh();
      setAttempts((n) => n + 1);
    }, intervalMs);

    return () => clearTimeout(timer);
  }, [
    checkoutState,
    isEntitled,
    attempts,
    maxAttempts,
    intervalMs,
    onNeedsRefresh,
  ]);

  if (checkoutState === null) {
    return null;
  }

  // Confirmed by the parent's own server-derived state — nothing left to
  // say. This is NOT this component asserting entitlement; it is ceasing
  // to describe a wait that is already over, per BillingPage's own read.
  if (checkoutState === "success" && isEntitled) {
    return null;
  }

  if (checkoutState === "cancelled") {
    return (
      <div
        role="status"
        className="mt-6 rounded-lg border border-border bg-muted/40 p-4"
      >
        <p className="text-sm text-muted-foreground">
          {translate("crm.billing.checkout.cancelled", {
            _: "No charge was made.",
          })}
        </p>
      </div>
    );
  }

  const timedOut = attempts >= maxAttempts;

  return (
    <div
      role="status"
      className="mt-6 rounded-lg border border-border bg-muted/40 p-4"
    >
      <p className="text-sm font-medium">
        {timedOut
          ? translate("crm.billing.checkout.timedOut.title", {
              _: "This is taking longer than usual",
            })
          : translate("crm.billing.checkout.confirming.title", {
              _: "Confirming your payment…",
            })}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {timedOut
          ? translate("crm.billing.checkout.timedOut.body", {
              _: "It will appear here as soon as Stripe confirms.",
            })
          : translate("crm.billing.checkout.confirming.body", {
              _: "Stripe is finishing your subscription — this usually takes a few seconds.",
            })}
      </p>
    </div>
  );
};
