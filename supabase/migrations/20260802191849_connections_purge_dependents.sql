set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.purge_connection_dependents()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from public.interactions
  where target_type = 'connection' and target_id = old.id;

  delete from public.tasks
  where target_type = 'connection' and target_id = old.id;

  delete from public.entity_files
  where target_type = 'connection' and target_id = old.id;

  return old;
end;
$function$
;

CREATE TRIGGER purge_connection_dependents_trigger BEFORE DELETE ON public.connections FOR EACH ROW EXECUTE FUNCTION public.purge_connection_dependents();


