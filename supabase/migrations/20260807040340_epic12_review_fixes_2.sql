alter table "public"."stripe_events" add column "status" text not null default 'received'::text;

alter table "public"."stripe_events" add constraint "stripe_events_status_check" CHECK ((status = ANY (ARRAY['received'::text, 'done'::text]))) not valid;

alter table "public"."stripe_events" validate constraint "stripe_events_status_check";


