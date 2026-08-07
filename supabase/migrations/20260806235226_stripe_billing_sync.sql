-- Story 12.4: Stripe billing. Adds Stripe identity to public.subscription and
-- a service-role-only idempotency ledger, public.stripe_events. Neither
-- touches public.ai_entitlement() (AC-1) or subscription's existing
-- SELECT-only RLS/grants — those stay exactly as they were.

  create table "public"."stripe_events" (
    "event_id" text not null,
    "type" text not null,
    "account_id" bigint,
    "received_at" timestamp with time zone not null default now(),
    "livemode" boolean not null default false
      );


alter table "public"."stripe_events" enable row level security;

alter table "public"."subscription" add column "last_stripe_event_at" timestamp with time zone;

-- MANUAL ADJUSTMENT (AC-2): db diff faithfully generated
-- `add column "provisioning_source" text not null default 'stripe'::text`,
-- because 01_tables.sql's declarative schema states only the FINAL shape.
-- Applied as-is, that single statement would stamp every pre-existing,
-- hand-provisioned subscription row (every row in production today — the
-- shipped Billing page's only path to the AI tier has always been "contact
-- us to turn it on by hand") as Stripe-owned. The next reconciliation sweep
-- would then find no matching Stripe subscription for any of them and lapse
-- a paying customer — the exact member_state failure shape (correct DDL, no
-- backfill). The two-step form below adds the column defaulting to
-- 'manual' — so every row that exists at the moment this migration runs
-- gets the correct, non-erasing value — then re-points the *default* at
-- 'stripe' for every row inserted after this point onward (i.e. every real
-- Stripe-provisioned subscription from here on). This is preferred over a
-- separate `update ... where stripe_subscription_id is null` precisely
-- because it cannot race a concurrent insert: there is no window in which a
-- new, genuinely Stripe-provisioned row could be swept up by the backfill.
alter table "public"."subscription" add column "provisioning_source" text not null default 'manual';
alter table "public"."subscription" alter column "provisioning_source" set default 'stripe';

alter table "public"."subscription" add column "stripe_customer_id" text;

alter table "public"."subscription" add column "stripe_price_id" text;

alter table "public"."subscription" add column "stripe_subscription_id" text;

CREATE UNIQUE INDEX stripe_events_pkey ON public.stripe_events USING btree (event_id);

CREATE UNIQUE INDEX subscription_stripe_customer_id_key ON public.subscription USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);

CREATE UNIQUE INDEX subscription_stripe_subscription_id_key ON public.subscription USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);

alter table "public"."stripe_events" add constraint "stripe_events_pkey" PRIMARY KEY using index "stripe_events_pkey";

alter table "public"."stripe_events" add constraint "stripe_events_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL not valid;

alter table "public"."stripe_events" validate constraint "stripe_events_account_id_fkey";

alter table "public"."subscription" add constraint "subscription_provisioning_source_check" CHECK ((provisioning_source = ANY (ARRAY['manual'::text, 'stripe'::text]))) not valid;

alter table "public"."subscription" validate constraint "subscription_provisioning_source_check";

-- MANUAL ADJUSTMENT: `db diff` emits the positive table grant below (left as
-- generated) but NOT the anon/authenticated revoke, exactly as
-- 20260806134139_ai_parse_attempts_quota_reservation.sql's own identical
-- comment explains — postgres-owned default privileges (06_grants.sql lines
-- ~64-72) auto-grant SELECT to `authenticated` unless explicitly revoked in
-- the same migration, so leaving this out would open a client SELECT path
-- onto stripe_events the moment this migration lands, directly contradicting
-- 05_policies.sql's "zero client policies" posture above and AC-3's own
-- failing condition.
revoke all on table "public"."stripe_events" from anon, authenticated;

grant delete on table "public"."stripe_events" to "service_role";

grant insert on table "public"."stripe_events" to "service_role";

grant references on table "public"."stripe_events" to "service_role";

grant select on table "public"."stripe_events" to "service_role";

grant trigger on table "public"."stripe_events" to "service_role";

grant truncate on table "public"."stripe_events" to "service_role";

grant update on table "public"."stripe_events" to "service_role";

-- No sequence grant: event_id is a `text` primary key (the Stripe event id
-- itself), not an identity column — there is no owned sequence to grant.
