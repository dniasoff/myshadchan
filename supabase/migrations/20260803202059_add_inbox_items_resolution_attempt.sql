alter table "public"."inbox_items" add column "resolution_attempt_id" text;

alter table "public"."inbox_items" add column "resolution_input" jsonb;


