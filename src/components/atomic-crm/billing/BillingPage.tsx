import { useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import { useAiEntitlementInfo } from "../references/useAiEntitlement";
import { AI_PRICE_MONTHLY, AI_PRICE_YEARLY } from "./billingPlans";
import { PlanCard } from "./PlanCard";
import { UsageMeter } from "./UsageMeter";

/**
 * Desktop /billing (E4). "Run at cost, not for profit": everything in
 * MyShadchan is free forever; the optional AI tier ($2/mo · $24/yr) only covers
 * what inference costs. This page shows the two tiers, the current plan, the
 * calm usage meter, and a graceful-lapse note.
 *
 * PAYMENT IS A STUB. No real payment provider is wired (no product/keys exist
 * yet), so the Subscribe control shows the price and a calm "coming soon /
 * contact to enable" state. It deliberately calls NO client path that could
 * grant entitlement — the only way an account becomes entitled is a server-side
 * (service_role) write to `subscription`, exactly as ai_entitlement() requires.
 */
export const BillingPage = () => {
  const translate = useTranslate();
  const { info, isLoading } = useAiEntitlementInfo();

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
            price: AI_PRICE_MONTHLY,
            _: "%{price} / month",
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
              <p className="text-sm text-muted-foreground">
                {translate("crm.billing.ai.active", {
                  _: "You are on the AI tier. Thank you for supporting the running costs.",
                })}
              </p>
            ) : (
              <SubscribeStub />
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

/**
 * The stubbed Subscribe control. It shows the price and a calm "not yet enabled"
 * state and does NOTHING on click — there is no payment provider wired, and
 * (by design) no client path that grants entitlement. Enabling the AI tier for
 * an account is a server-side action today.
 */
const SubscribeStub = () => {
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" className="w-full" disabled aria-disabled="true">
        {translate("crm.billing.subscribe.cta", { _: "Subscribe" })}
      </Button>
      <p className="text-xs text-muted-foreground">
        {translate("crm.billing.subscribe.note", {
          _: "Payments aren't enabled yet. Contact us to turn on the AI tier for your account — the free plan keeps working in the meantime.",
        })}
      </p>
    </div>
  );
};

BillingPage.path = "/billing";
