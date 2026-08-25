-- Prevent account deletion from leaving inbox captures orphaned.
-- Validate separately so any pre-existing orphan fails the migration loudly
-- instead of being silently discarded.
alter table public.inbox_items
  add constraint inbox_items_account_id_fkey
  foreign key (account_id)
  references public.accounts(id)
  on delete cascade
  not valid;

alter table public.inbox_items
  validate constraint inbox_items_account_id_fkey;
