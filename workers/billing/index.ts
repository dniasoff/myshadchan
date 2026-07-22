import { createWorkerApp } from "../shared/createApp";
import { fail } from "../shared/envelope";
import type { BaseEnv } from "../shared/env";

// Billing (AD-16) lands here: Checkout + a signature-verified, idempotent
// Stripe webhook syncing `accounts`. Only the health route and a stub webhook
// route (that refuses to process without a signature header) exist for now —
// real signature verification needs the Stripe SDK + STRIPE_WEBHOOK_SECRET,
// which is future work.
export interface BillingEnv extends BaseEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

const app = createWorkerApp<BillingEnv>("billing");

app.post("/webhook", (c) => {
  if (!c.req.header("stripe-signature")) {
    return c.json(fail("missing stripe-signature header"), 400);
  }
  return c.json(fail("webhook processing not implemented yet"), 501);
});

export default app;
