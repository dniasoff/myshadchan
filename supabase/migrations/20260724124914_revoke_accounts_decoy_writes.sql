-- Revoke client writes to the legacy billing columns on public.accounts
-- (stripe_customer_id, subscription_status, plan, current_period_end,
-- trial_end). These are UNUSED schema-readiness fields (AD-16); the only
-- entitlement authority is the `subscription` table via public.ai_entitlement().
-- A client-writable `accounts.plan = 'ai'` would be an instant paywall bypass
-- the day any code read it, so close the write path now.
--
-- A bare column-level `revoke update (plan, ...)` is a no-op while a table-level
-- `grant update on accounts` exists (a column revoke cannot subtract from a
-- table-level grant). So revoke table-level UPDATE and re-grant UPDATE only on
-- the mutable business columns — the same idiom already used for interactions.
-- Today the client updates only `name`; transparency_level/data_region are the
-- account-config columns a settings screen would edit. `demo` is server-owned
-- (written only by the seed_demo/clear_demo edge functions via service_role,
-- which bypasses these grants). The five billing columns are then unreachable
-- by any client. anon already has ALL revoked on accounts, so it holds no
-- UPDATE to narrow.
--
-- NOTE: `supabase db diff` (migra) does not diff column-level grants, so it
-- generated only the `revoke` line; the `grant ... (columns)` below was added
-- by hand to keep this migration consistent with supabase/schemas/06_grants.sql.

revoke update on table "public"."accounts" from "authenticated";

grant update ("name", "transparency_level", "data_region")
  on table "public"."accounts" to "authenticated";
