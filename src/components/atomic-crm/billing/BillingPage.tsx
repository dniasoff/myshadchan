import { useCallback } from "react";
import { useTranslate } from "ra-core";
import { useQueryClient } from "@tanstack/react-query";

import {
  AI_ENTITLEMENT_QUERY_KEY,
  useAiEntitlementInfo,
} from "../references/useAiEntitlement";
import { AI_PRICE_QUARTERLY, AI_PRICE_YEARLY } from "./billingPlans";
import { BillingReturnNotice } from "./BillingReturnNotice";
import { ManageSubscriptionButton } from "./ManageSubscriptionButton";
import { PlanCard } from "./PlanCard";
import { SubscribeButton } from "./SubscribeButton";
import { UsageMeter } from "./UsageMeter";

/**
 * Desktop /billing (E4/Story 12.4). "Run at cost, not for profit": everything
 * in MyShadchan is free forever; the optional AI tier ($6 / 3 months ·
 * $24/yr) only covers what inference costs. This page shows the two tiers,
 * the current plan, the calm usage meter, and a graceful-lapse note.
 *
 * PAYMENT IS REAL (Story 12.4). `SubscribeButton` POSTs `/checkout` and
 * `ManageSubscriptionButton` POSTs `/portal` against the billing Worker, both
 * hosted-redirect flows to Stripe. Neither writes or asserts entitlement:
 * `isEntitled`/`isLapsed` below are derived ONLY from `info`, i.e. from the
 * server's `ai_entitlement()` — the only way an account becomes entitled is
 * the webhook's own service_role write to `subscription`.
 */
export const BillingPage = () => {
  const translate = useTranslate();
  const queryClient = useQueryClient();
  const { info, isLoading } = useAiEntitlementInfo();

  // Passed down to BillingReturnNotice rather than it calling
  // useAiEntitlementInfo/useQueryClient itself — keeps every reference to
  // the entitlement hook and its query key inside this file, per
  // entitlementGate.guard.test.ts's "pass props down" option.
  const refreshEntitlement = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: AI_ENTITLEMENT_QUERY_KEY });
  }, [queryClient]);

  if (isLoading) {
    return (
      <div className="mx-auto mt-10 w-full max-w-4xl px-6">
        <div className="h-64 animate-pulse rounded-2xl bg-secondary/50" />
      </div>
    );
  }

  const isEntitled = info.is_entitled;
  const isLapsed = info.status === "lapsed";

  const freeFeatures = [
    translate("crm.billing.free.f1", {
      _: "The full suggestions pipeline and Kanban board",
    }),
    translate("crm.billing.free.f2", {
      _: "References, call log and reminders",
    }),
    translate("crm.billing.free.f3", {
      _: "Catch & dedupe — 'you've come across this person before'",
    }),
    translate("crm.billing.free.f4", {
      _: "Match-on-entry as you type",
    }),
    translate("crm.billing.free.f5", {
      _: "Manual entry of every field",
    }),
  ];

  const aiFeatures = [
    translate("crm.billing.ai.f1", {
      _: "Resume auto-parse (OCR) — fields filled in for you",
    }),
    translate("crm.billing.ai.f2", {
      _: "Research assistant — tailored questions and a call script",
    }),
    translate("crm.billing.ai.f3", {
      _: "Cross-reference gaps — what everyone agreed on, what is still missing",
    }),
  ];

  return (
    <div className="mx-auto mt-10 w-full max-w-4xl px-6 pb-16">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {translate("crm.billing.eyebrow", { _: "AI features" })}
        </p>
        <h1 className="font-display text-[2rem] font-bold tracking-tight">
          {translate("crm.billing.title", { _: "Billing" })}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {translate("crm.billing.intro", {
            _: "Run at cost, not for profit. Everything here is free forever — the optional AI tier only covers what inference actually costs.",
          })}
        </p>
      </div>

      {isLapsed ? (
        <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium">
            {translate("crm.billing.lapsed.title", {
              _: "Your AI tier has paused",
            })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {translate("crm.billing.lapsed.body", {
              _: "Nothing is lost — every note, reference and match is still here, and the free manual path works exactly as before. AI auto-fill simply pauses. Renew whenever you like.",
            })}
          </p>
        </div>
      ) : null}

      <BillingReturnNotice
        isEntitled={isEntitled}
        onNeedsRefresh={refreshEntitlement}
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-2 lg:items-stretch">
        <PlanCard
          name={translate("crm.billing.free.name", { _: "Free forever" })}
          priceLabel={translate("crm.billing.free.price", { _: "$0" })}
          priceSubLabel={translate("crm.billing.free.priceSub", {
            _: "Always free. No card required.",
          })}
          features={freeFeatures}
          isCurrent={!isEntitled}
        />

        <PlanCard
          name={translate("crm.billing.ai.name", { _: "AI tier" })}
          priceLabel={translate("crm.billing.ai.price", {
            price: AI_PRICE_QUARTERLY,
            _: "%{price} / 3 months",
          })}
          priceSubLabel={translate("crm.billing.ai.priceSub", {
            price: AI_PRICE_YEARLY,
            _: "or %{price} / year",
          })}
          features={aiFeatures}
          isCurrent={isEntitled}
          highlighted={!isEntitled}
          cta={
            isEntitled ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  {translate("crm.billing.ai.active", {
                    _: "You are on the AI tier. Thank you for supporting the running costs.",
                  })}
                </p>
                <ManageSubscriptionButton info={info} />
              </div>
            ) : isLapsed ? (
              <ManageSubscriptionButton info={info} />
            ) : (
              <SubscribeButton />
            )
          }
        />
      </div>

      <div className="mt-6">
        <UsageMeter used={info.resumes_used} limit={info.resumes_limit} />
      </div>
    </div>
  );
};

BillingPage.path = "/billing";
