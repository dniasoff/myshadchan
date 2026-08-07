import { useState } from "react";
import { useNotify, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import { callBillingWorker } from "../providers/commons/billingClient";
import type { AiEntitlementInfo } from "../types";

/**
 * The ONLY upgrade / downgrade / cancel / card-update surface (AC-9). Visible
 * only when the account is currently entitled or lapsed — i.e. only when a
 * Stripe customer/subscription can plausibly exist to manage. POSTs
 * `POST /portal` and redirects to Stripe's own hosted Billing Portal; no
 * plan-change, cancel, or card-entry control is ever rendered here, which is
 * what keeps card data off this origin (PCI SAQ-A, AD-16). Every lifecycle
 * change made in the portal comes back as a webhook event and lands via the
 * worker's `/webhook` route, never through this component.
 *
 * `redirectTo` mirrors `SubscribeButton`'s own seam — defaults to a real
 * `window.location.assign`, overridable so a test can observe the redirect
 * without a real browser navigation tearing down the test page.
 */
export const ManageSubscriptionButton = ({
  info,
  redirectTo = (url: string) => window.location.assign(url),
}: {
  info: AiEntitlementInfo;
  redirectTo?: (url: string) => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const [isPending, setIsPending] = useState(false);

  if (!info.is_entitled && info.status !== "lapsed") {
    return null;
  }

  const openPortal = async () => {
    setIsPending(true);
    try {
      const { url } = await callBillingWorker<{ url: string }>(
        `${import.meta.env.VITE_BILLING_WORKER_URL}/portal`,
        {},
      );
      redirectTo(url);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.billing.manage.error", {
              _: "Couldn't open the billing portal. Please try again.",
            }),
        { type: "error" },
      );
      setIsPending(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={isPending}
      onClick={() => void openPortal()}
    >
      {isPending
        ? translate("crm.billing.manage.pending", {
            _: "Opening billing portal…",
          })
        : translate("crm.billing.manage.cta", { _: "Manage subscription" })}
    </Button>
  );
};
