import { useState } from "react";
import { useNotify, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import { callBillingWorker } from "../providers/commons/billingClient";
import { AI_PRICE_QUARTERLY, AI_PRICE_YEARLY } from "./billingPlans";

type BillingCadence = "quarterly" | "yearly";

/**
 * Replaces the old `SubscribeStub` (E4's payment-not-wired placeholder,
 * BillingPage.tsx). POSTs `POST /checkout` (AC-8) and redirects the browser
 * to the returned Stripe Checkout URL.
 *
 * This is the ONLY thing a click here does. It writes no entitlement of its
 * own — a Checkout Session grants nothing until Stripe's webhook confirms it
 * (see BillingReturnNotice's own comment for why the return redirect is a
 * hint, never a grant).
 *
 * `redirectTo` defaults to a real `window.location.assign` and exists as a
 * seam so a test can observe "redirected to <url>" without a real browser
 * navigation tearing down the test page mid-run.
 */
export const SubscribeButton = ({
  redirectTo = (url: string) => window.location.assign(url),
}: {
  redirectTo?: (url: string) => void;
} = {}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const [pendingCadence, setPendingCadence] = useState<BillingCadence | null>(
    null,
  );

  const subscribe = async (cadence: BillingCadence) => {
    setPendingCadence(cadence);
    try {
      const { url } = await callBillingWorker<{ url: string }>(
        `${import.meta.env.VITE_BILLING_WORKER_URL}/checkout`,
        { cadence },
      );
      redirectTo(url);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("crm.billing.subscribe.error", {
              _: "Couldn't start checkout. Please try again.",
            }),
        { type: "error" },
      );
      setPendingCadence(null);
    }
  };

  const isPending = pendingCadence !== null;

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        className="w-full"
        disabled={isPending}
        onClick={() => void subscribe("quarterly")}
      >
        {pendingCadence === "quarterly"
          ? translate("crm.billing.subscribe.pending", {
              _: "Redirecting to Stripe…",
            })
          : translate("crm.billing.subscribe.quarterlyCta", {
              price: AI_PRICE_QUARTERLY,
              _: "Subscribe — %{price} / 3 months",
            })}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        disabled={isPending}
        onClick={() => void subscribe("yearly")}
      >
        {pendingCadence === "yearly"
          ? translate("crm.billing.subscribe.pending", {
              _: "Redirecting to Stripe…",
            })
          : translate("crm.billing.subscribe.yearlyCta", {
              price: AI_PRICE_YEARLY,
              _: "or pay yearly — %{price} / year",
            })}
      </Button>
    </div>
  );
};
