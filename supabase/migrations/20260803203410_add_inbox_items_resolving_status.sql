alter table "public"."inbox_items" drop constraint "inbox_items_status_check";

alter table "public"."inbox_items" add constraint "inbox_items_status_check" CHECK ((status = ANY (ARRAY['unresolved'::text, 'resolving'::text, 'resolved'::text, 'dismissed'::text]))) not valid;

alter table "public"."inbox_items" validate constraint "inbox_items_status_check";


