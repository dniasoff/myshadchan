-- Retire the signup age-gate.
--
-- `check_signup_age()` was the `before_user_created` Auth Hook: it 403'd any
-- signup that had not affirmed being 18+, reading that affirmation either
-- from the email/OTP signup's `user_metadata` or — for a Google OAuth signup,
-- where `signInWithOAuth()` cannot set `user_metadata` at all — from a
-- short-lived `public.signup_intents` row keyed on the email. Needing that
-- row keyed on an email BEFORE the redirect is what forced /register's
-- "Continue with Google" to demand a typed email first, for a button whose
-- whole point is that Google already knows who you are.
--
-- The affirmation is now made by the act of creating an account and stated as
-- such in the UI (`AgeNotice`), so there is nothing left to transmit and
-- nothing for a hook to verify. This loses no enforcement that existed:
-- `signup_intents` is INSERTable by `anon` for any address (deliberately —
-- no account exists yet), so a row asserting "18+ for this email" was always
-- exactly as strong as the client asserting `age_affirmed` in `meta`, which
-- is to say a self-declaration, never a check.
--
-- DATA LOSS IS INTENDED AND DECLARED. Every row here is a single-use token
-- that expires ten minutes after it is written, is consumed by the signup it
-- belongs to, and is read by nothing else in the product; an unconsumed row
-- means a signup that never completed. See
-- `migration_guard.discarded_tables` in
-- supabase/tests/migration-data-safety/declared-moves.sql for the
-- declaration the data-safety guard verifies this against.
--
-- Dropping the table is safer than keeping it: `check_signup_age()` was also
-- its only sweeper (this repo runs no pg_cron), so leaving it behind would
-- strand an `anon`-INSERTable table with nothing consuming or expiring its
-- rows.
--
-- ORDERING WITH THE HOSTED PROJECT: `supabase/config.toml` is never synced,
-- so the hosted project's `hook_before_user_created_enabled` is whatever the
-- last deploy PATCHed it to — `true`. .github/workflows/deploy.yml therefore
-- PATCHes it to `false` in a step that runs BEFORE `db push`. That order is
-- required: a project still naming a function this migration has dropped
-- answers every signup with a GoTrue 500, "Error running hook URI".

drop policy "Signup intents insertable by anon" on "public"."signup_intents";

revoke insert on table "public"."signup_intents" from "anon";

revoke delete on table "public"."signup_intents" from "service_role";

revoke insert on table "public"."signup_intents" from "service_role";

revoke references on table "public"."signup_intents" from "service_role";

revoke select on table "public"."signup_intents" from "service_role";

revoke trigger on table "public"."signup_intents" from "service_role";

revoke truncate on table "public"."signup_intents" from "service_role";

revoke update on table "public"."signup_intents" from "service_role";

drop function if exists "public"."check_signup_age"(event jsonb);

alter table "public"."signup_intents" drop constraint "signup_intents_pkey";

drop index if exists "public"."signup_intents_email_idx";

drop index if exists "public"."signup_intents_pkey";

drop table "public"."signup_intents";


