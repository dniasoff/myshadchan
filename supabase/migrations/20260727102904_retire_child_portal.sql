drop trigger if exists "set_child_portal_token_defaults" on "public"."child_portal_tokens";

drop policy "Child portal tokens scoped to account" on "public"."child_portal_tokens";

revoke insert on table "public"."child_portal_tokens" from "authenticated";

revoke select on table "public"."child_portal_tokens" from "authenticated";

revoke update on table "public"."child_portal_tokens" from "authenticated";

revoke delete on table "public"."child_portal_tokens" from "service_role";

revoke insert on table "public"."child_portal_tokens" from "service_role";

revoke references on table "public"."child_portal_tokens" from "service_role";

revoke select on table "public"."child_portal_tokens" from "service_role";

revoke trigger on table "public"."child_portal_tokens" from "service_role";

revoke truncate on table "public"."child_portal_tokens" from "service_role";

revoke update on table "public"."child_portal_tokens" from "service_role";

alter table "public"."child_portal_tokens" drop constraint "child_portal_tokens_account_id_fkey";

alter table "public"."child_portal_tokens" drop constraint "child_portal_tokens_child_id_fkey";

alter table "public"."child_portal_tokens" drop constraint "child_portal_tokens_token_key";

drop function if exists "public"."get_child_portal"(p_token text);

drop function if exists "public"."set_child_portal_token_defaults"();

alter table "public"."child_portal_tokens" drop constraint "child_portal_tokens_pkey";

drop index if exists "public"."child_portal_tokens_account_id_idx";

drop index if exists "public"."child_portal_tokens_child_id_idx";

drop index if exists "public"."child_portal_tokens_pkey";

drop index if exists "public"."child_portal_tokens_token_key";

drop table "public"."child_portal_tokens";


