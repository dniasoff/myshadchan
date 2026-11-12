-- THROWAWAY ONLY: prove the non-empty-table migration gate catches a populated drop.
alter table public.members drop column first_name;
