-- FR75: allow subscription.status = 'past_due'.
--
-- The declarative schema (01_tables.sql) has declared four values since the
-- billing work landed, but the database only ever allowed three — the
-- migration was never generated, because `supabase db diff` could not run in
-- this repo (see 02_functions.sql's header). So the schema-first workflow
-- silently produced no migration and the database quietly diverged.
--
-- The consequence is a live defect, not a tidiness issue. subscriptionState.ts
-- maps Stripe's past_due to status 'past_due', and the database rejects the
-- write with a check-constraint violation. Verified against a stack built from
-- this repo's own migrations: inserting 'past_due' fails. So the grace window
-- never starts, sweepGraceWindow() never finds a row, and no dunning email is
-- ever sent.
--
-- Widening a CHECK cannot invalidate an existing row: every value currently
-- stored is still permitted. `not valid` + `validate` keeps the table from
-- being rewritten under an ACCESS EXCLUSIVE lock for longer than necessary.

alter table "public"."subscription" drop constraint "subscription_status_check";

alter table "public"."subscription" add constraint "subscription_status_check"
    CHECK ((status = ANY (ARRAY['active'::text, 'past_due'::text, 'lapsed'::text, 'none'::text]))) not valid;

alter table "public"."subscription" validate constraint "subscription_status_check";
