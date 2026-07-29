alter table "public"."tasks" drop constraint "tasks_target_type_check";

alter table "public"."tasks" add constraint "tasks_target_type_check" CHECK ((target_type = ANY (ARRAY['shadchan'::text, 'shidduch'::text, 'reference'::text, 'single'::text]))) not valid;

alter table "public"."tasks" validate constraint "tasks_target_type_check";


