drop trigger if exists "on_auth_user_updated" on "auth"."users";

CREATE TRIGGER on_auth_user_updated AFTER UPDATE ON auth.users FOR EACH ROW WHEN (((old.raw_user_meta_data IS DISTINCT FROM new.raw_user_meta_data) OR ((old.email)::text IS DISTINCT FROM (new.email)::text))) EXECUTE FUNCTION public.handle_update_user();


